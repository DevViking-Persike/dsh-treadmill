/**
 * OpenNjord Treadmill installation owned by the harness.
 *
 * The package vendors the complete `.opennjord` installation (skills, rules,
 * commands, agents, integrations, tools, and the `esteira/pipeline.yaml` stage
 * table) under `assets/opennjord`. On first use it copies that tree into an
 * editable root (`<dshHome>/treadmill` by default) and from then on serves the
 * root: its `skills` and `commands` directories become one filesystem Skill
 * provider for every project, its rules index and tool paths become one
 * system-prompt section per agent, and its files are readable and writable
 * through the `ctx.treadmill` service so a client can edit them in place.
 *
 * A project therefore keeps no `.opennjord`, `.claude`, or `.codex` copy: the
 * harness owns the method, the project owns `.spec/` and `docs/adrs/`.
 *
 * The `treadmill` user-settings section carries one `enabled` switch. Off, the
 * provider serves no skill, the prompt section is empty, and `describe()`
 * reports the state so clients hide their Treadmill surfaces.
 *
 * @module @persike/dsh-treadmill
 */
import { cp, mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { isAbsolute, join, normalize, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Service } from '@deepseek-ai/cordis';
import z from '@deepseek-ai/schemastery';
import { isMap, isSeq, parse as parseYaml, parseDocument } from 'yaml';
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths';
import { FileSystemSkillProvider } from '@deepseek-ai/dsh-skill-filesystem';
/** Provider name under which the installation's skills and commands register. */
export const PROVIDER_NAME = 'treadmill';
/** Absolute path of the vendored `.opennjord` installation the editable root is seeded from. */
export const TREADMILL_ASSETS = fileURLToPath(new URL('../assets/opennjord/', import.meta.url));
/** Relative path, inside the root, of the editable stage table. */
export const PIPELINE_FILE = 'esteira/pipeline.yaml';
/** Prompt order of the rules section: after tool guidance, before contexts. */
const PROMPT_ORDER = 150;
const NS = 'treadmill';
/** Plugin configuration schema. */
export const Config = z.object({
    root: z.string(),
    enabled: z.boolean().default(true),
});
const SettingsSchema = z.object({ enabled: z.boolean().default(true) });
/** Failure of a file operation inside the installation root. */
export class TreadmillError extends Error {
    code;
    constructor(code, message) {
        super(message);
        this.code = code;
        this.name = 'TreadmillError';
    }
}
const StageSchema = z.object({
    id: z.string().required(),
    label: z.string().required(),
    section: z.string().required(),
    skill: z.string().required(),
    args: z.string().default(''),
    gate: z.union(['manual', 'auto']).default('auto'),
    verdict: z.boolean().default(false),
    produces: z.array(z.string()).default([]),
    enabled: z.boolean().default(true),
    requires: z.array(z.string()).default([]),
});
const PipelineSchema = z.object({
    schema: z.number().required(),
    stages: z.array(StageSchema).required(),
});
function describeError(error) {
    return error instanceof Error ? error.message : String(error);
}
/**
 * Parse the stage table. Ids are unique; dependencies must precede consumers.
 * A disabled dependency disables its consumers. Blank `args` is omitted.
 * @param text - `esteira/pipeline.yaml` content.
 * @returns the stages in file order.
 */
export function parsePipeline(text) {
    const raw = parseYaml(text);
    const parsed = PipelineSchema(raw);
    const seen = new Set();
    const disabled = new Set();
    return parsed.stages.map((stage) => {
        const id = stage.id;
        if (seen.has(id))
            throw new Error(`duplicate stage id "${id}"`);
        for (const dependency of stage.requires) {
            if (!seen.has(dependency))
                throw new Error(`stage "${id}" requires an earlier stage "${dependency}"`);
        }
        seen.add(id);
        const enabled = stage.enabled && !stage.requires.some(dependency => disabled.has(dependency));
        if (!enabled)
            disabled.add(id);
        return {
            id, label: stage.label, section: stage.section, skill: stage.skill,
            ...stage.args.length === 0 ? {} : { args: stage.args },
            gate: stage.gate, verdict: stage.verdict, produces: stage.produces, enabled,
            ...stage.requires.length === 0 ? {} : { requires: stage.requires },
        };
    });
}
/**
 * Update one stage's switches in a stage table's YAML text, keeping comments
 * and layout. Shared by the harness default table and a project's own copy.
 * @param text - `pipeline.yaml` or `.spec/treadmill.yaml` content.
 * @param id - stage id as the table lists it.
 * @param patch - the switches to set; an absent field keeps its value.
 * @returns the rewritten YAML.
 * Disabling cascades to dependent stages; enabling requires enabled prerequisites.
 * @throws TreadmillError `not-found` for an unknown id, or `denied` for a disabled prerequisite.
 */
export function updateStageInTable(text, id, patch) {
    const table = parsePipeline(text);
    const document = parseDocument(text);
    const stages = document.get('stages');
    const stage = isSeq(stages)
        ? stages.items.find(item => isMap(item) && String(item.get('id')) === id)
        : undefined;
    if (stage === undefined || !isMap(stage))
        throw new TreadmillError('not-found', `stage "${id}" is not in the stage table`);
    if (patch.enabled === true) {
        const prerequisites = table.find(candidate => candidate.id === id)?.requires ?? [];
        const blocked = prerequisites.filter(dependency => !table.find(candidate => candidate.id === dependency)?.enabled);
        if (blocked.length > 0)
            throw new TreadmillError('denied', `enable required stages first: ${blocked.join(', ')}`);
    }
    if (patch.enabled !== undefined)
        stage.set('enabled', patch.enabled);
    if (patch.enabled === false && isSeq(stages)) {
        const disabled = new Set([id]);
        for (const candidate of table) {
            if (!candidate.requires?.some(dependency => disabled.has(dependency)))
                continue;
            disabled.add(candidate.id);
            const dependent = stages.items.find(item => isMap(item) && String(item.get('id')) === candidate.id);
            if (isMap(dependent))
                dependent.set('enabled', false);
        }
    }
    if (patch.gate !== undefined)
        stage.set('gate', patch.gate);
    return document.toString();
}
/** Host-owned installation: seeding, file access, stage table, and the rules index. */
export class TreadmillService extends Service {
    static inject = ['skills', 'agents'];
    static Config = Config;
    /** Editable installation root. */
    root;
    enabledByConfig;
    settings;
    invalidate;
    provider;
    rulesIndex = '';
    /** Seeding and the first rules index; every file operation waits for it. */
    ready;
    promptFibers = new Map();
    constructor(ctx, config = {}) {
        super(ctx, 'treadmill');
        this.root = resolve(config.root ?? join(resolveDshHome(), 'treadmill'));
        this.enabledByConfig = config.enabled ?? true;
        this.settings = () => ({ enabled: this.enabledByConfig });
        this.ready = this.seed().then(() => this.refreshRulesIndex());
        ctx.inject(['settings'], (settingsCtx) => {
            settingsCtx.settings.installSection(ctx, NS, SettingsSchema, { enabled: this.enabledByConfig }, {
                setSource: (source) => { this.settings = source; },
                onChange: () => { this.invalidate?.(); },
            });
        });
        ctx.skills.registerProvider((control) => {
            this.invalidate = control.invalidate;
            this.provider = new FileSystemSkillProvider(ctx, control, {
                providerName: PROVIDER_NAME,
                includeDefaultRoots: false,
                customSkillDirs: [join(this.root, 'skills'), join(this.root, 'commands')],
                watch: false,
            });
            return this.gated(this.provider);
        });
        ctx.effect(function* () {
            yield async () => { await this.provider?.dispose(); };
        }.bind(this), 'treadmill provider');
        const installPrompt = (agent) => {
            if (this.promptFibers.has(agent))
                return;
            this.promptFibers.set(agent, agent.ctx.inject(['systemPrompt'], (scope) => {
                scope.systemPrompt.section({ name: 'treadmill:rules', order: PROMPT_ORDER, text: () => this.promptText() });
            }));
        };
        for (const agent of ctx.agents.list())
            installPrompt(agent);
        ctx.on('agent/created', ({ agent }) => { installPrompt(agent); });
        ctx.on('agent/disposed', ({ agent }) => {
            const fiber = this.promptFibers.get(agent);
            this.promptFibers.delete(agent);
            void fiber?.dispose().catch((error) => {
                ctx.logger.warn(`treadmill: prompt cleanup failed: ${describeError(error)}`);
            });
        });
    }
    /**
     * Whether the Treadmill is served: the composition default gated by the user setting.
     * @returns `true` while skills and the prompt section are served.
     */
    enabled() {
        return this.settings().enabled;
    }
    /**
     * Copy what the vendored installation has and the root lacks: every
     * top-level category, and inside an existing category every direct child
     * (a skill directory, a rule file, a command). Existing entries are never
     * overwritten, so edits survive updates while a new skill still arrives.
     */
    async seed() {
        await mkdir(this.root, { recursive: true });
        for (const entry of await readdir(TREADMILL_ASSETS, { withFileTypes: true })) {
            const source = join(TREADMILL_ASSETS, entry.name);
            const target = join(this.root, entry.name);
            if (!await this.copyMissing(source, target))
                continue;
            if (!entry.isDirectory())
                continue;
            for (const child of await readdir(source))
                await this.copyMissing(join(source, child), join(target, child));
        }
    }
    /** Copy `source` to `target` unless `target` exists; `true` when it already existed. */
    async copyMissing(source, target) {
        const present = await stat(target).then(() => true, () => false);
        if (!present)
            await cp(source, target, { recursive: true });
        return present;
    }
    gated(inner) {
        return {
            name: inner.name,
            list: async (options) => {
                await this.ready;
                return this.enabled() ? inner.list(options) : [];
            },
            get: (candidate, options) => inner.get(candidate, options),
        };
    }
    /**
     * Resolve one installation-relative path, refusing anything that would
     * leave the root.
     * @param path - relative path as a client sent it.
     * @returns the absolute path inside the root.
     */
    target(path) {
        const clean = normalize(path);
        if (isAbsolute(clean) || clean === '.' || clean.startsWith('..')) {
            throw new TreadmillError('denied', `"${path}" is outside the OpenNjord installation`);
        }
        const absolute = resolve(this.root, clean);
        if (!absolute.startsWith(this.root + sep))
            throw new TreadmillError('denied', `"${path}" is outside the OpenNjord installation`);
        return absolute;
    }
    /**
     * Read one installation file.
     * @param path - path relative to the root.
     * @returns the file text.
     */
    async readFile(path) {
        await this.ready;
        try {
            return await readFile(this.target(path), 'utf8');
        }
        catch (error) {
            if (error.code === 'ENOENT')
                throw new TreadmillError('not-found', `"${path}" does not exist`);
            throw error;
        }
    }
    /**
     * Write one installation file, creating parent directories, then refresh
     * the skill catalog and the rules index.
     * @param path - path relative to the root.
     * @param content - new text.
     */
    async writeFile(path, content) {
        await this.ready;
        const absolute = this.target(path);
        await mkdir(resolve(absolute, '..'), { recursive: true });
        await writeFile(absolute, content, 'utf8');
        await this.refreshRulesIndex();
        this.invalidate?.();
    }
    /**
     * Update one stage's switches in `esteira/pipeline.yaml`, keeping the file's
     * comments and layout. A disabled stage stays listed and is skipped; a
     * `manual` gate waits for the run action, an `auto` gate follows through.
     * @param id - stage id as the table lists it.
     * @param patch - the switches to set.
     */
    async updateStage(id, patch) {
        await this.writeFile(PIPELINE_FILE, updateStageInTable(await this.readFile(PIPELINE_FILE), id, patch));
    }
    /**
     * The stage table, parsed from `esteira/pipeline.yaml`.
     * @returns the stages, or the parse failure.
     */
    async stages() {
        try {
            return { stages: parsePipeline(await this.readFile(PIPELINE_FILE)) };
        }
        catch (error) {
            return { stages: [], error: describeError(error) };
        }
    }
    /**
     * Describe the installation: root, enabled state, stages, and every file.
     * @returns the description.
     */
    async describe() {
        await this.ready;
        const [{ stages, error }, files] = await Promise.all([this.stages(), this.files()]);
        return {
            root: this.root, enabled: this.enabled(), stages, files,
            ...error === undefined ? {} : { pipelineError: error },
        };
    }
    async files() {
        const result = [];
        const walk = async (dir) => {
            const entries = await readdir(dir, { withFileTypes: true });
            entries.sort((a, b) => a.name.localeCompare(b.name));
            for (const entry of entries) {
                if (entry.name.startsWith('.'))
                    continue;
                const absolute = join(dir, entry.name);
                if (entry.isDirectory()) {
                    await walk(absolute);
                }
                else if (entry.isFile()) {
                    const path = relative(this.root, absolute).split(sep).join('/');
                    result.push({ path, category: path.split('/')[0] ?? '', size: (await stat(absolute)).size });
                }
            }
        };
        await walk(this.root);
        return result;
    }
    async refreshRulesIndex() {
        const lines = [];
        const rules = join(this.root, 'rules');
        const walk = async (dir) => {
            const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
            entries.sort((a, b) => a.name.localeCompare(b.name));
            for (const entry of entries) {
                const absolute = join(dir, entry.name);
                if (entry.isDirectory())
                    await walk(absolute);
                else if (entry.isFile() && entry.name.endsWith('.md') && !entry.name.startsWith('_') && entry.name !== 'README.md') {
                    const heading = (await readFile(absolute, 'utf8')).split('\n').find(line => line.startsWith('# '));
                    lines.push(`- ${absolute}${heading === undefined ? '' : ` — ${heading.slice(2).trim()}`}`);
                }
            }
        };
        await walk(rules);
        this.rulesIndex = lines.join('\n');
    }
    /**
     * The per-agent prompt section: installation root, rules index, and tool paths.
     * @returns the section text, empty while disabled.
     */
    promptText() {
        if (!this.enabled())
            return '';
        return [
            '## OpenNjord Treadmill',
            `The Treadmill installation lives at ${this.root} (skills, rules, commands, agents, tools). It is not copied into projects: a project owns only .spec/ (cursor, discovery, sprints, tasks, evidence) and docs/adrs/ (ADRs).`,
            'Engineering rules apply to every change. Read the ones relevant to the task before editing:',
            this.rulesIndex,
            `Validation tools: ${join(this.root, 'tools')}/spec-check.sh and esteira-check.sh; run them with bash from the project root.`,
        ].filter(part => part.length > 0).join('\n');
    }
}
/** Cordis plugin name. */
export const name = 'treadmill';
export default TreadmillService;
//# sourceMappingURL=index.js.map