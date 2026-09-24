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
import { Service, type Context } from '@deepseek-ai/cordis';
import z from '@deepseek-ai/schemastery';
import type Schema from '@deepseek-ai/schemastery';
/** Provider name under which the installation's skills and commands register. */
export declare const PROVIDER_NAME = "treadmill";
/** Absolute path of the vendored `.opennjord` installation the editable root is seeded from. */
export declare const TREADMILL_ASSETS: string;
/** Relative path, inside the root, of the editable stage table. */
export declare const PIPELINE_FILE = "esteira/pipeline.yaml";
/** Plugin configuration. */
export interface Config {
    /** Editable installation root. Defaults to `<dshHome>/treadmill`. */
    root?: string;
    /** Whether the Treadmill is served; the `treadmill.enabled` user setting layers over it. */
    enabled?: boolean;
}
/** Plugin configuration schema. */
export declare const Config: Schema<Config>;
/** The `treadmill` user-settings section. */
export interface TreadmillSettings {
    enabled: boolean;
}
/** One stage of the Treadmill as `esteira/pipeline.yaml` declares it. */
export interface TreadmillStage {
    readonly id: string;
    readonly label: string;
    readonly section: string;
    /** Skill slug invoked as `/<skill>`; `args` follows it, and `sprint` receives the active sprint. */
    readonly skill: string;
    readonly args?: string;
    /** `manual` stages stop for a human decision before the process advances. */
    readonly gate: 'manual' | 'auto';
    readonly verdict: boolean;
    /** A disabled stage stays in the table but is skipped: the cursor advances past it. */
    readonly enabled: boolean;
    /** Earlier stages whose evidence this stage consumes; disabling one skips this stage. */
    readonly requires?: readonly string[];
    /** Project directories the stage writes, relative to the project root. */
    readonly produces: readonly string[];
}
/** One file of the installation, relative to the root. */
export interface TreadmillFile {
    readonly path: string;
    /** First path segment: `skills`, `rules`, `commands`, `agents`, `tools`, `integrations`, or `esteira`. */
    readonly category: string;
    readonly size: number;
}
/** The installation as clients see it. */
export interface TreadmillDescription {
    readonly root: string;
    readonly enabled: boolean;
    readonly stages: readonly TreadmillStage[];
    /** Set when `esteira/pipeline.yaml` is unreadable or invalid; `stages` is then empty. */
    readonly pipelineError?: string;
    readonly files: readonly TreadmillFile[];
}
/** Failure of a file operation inside the installation root. */
export declare class TreadmillError extends Error {
    readonly code: 'denied' | 'not-found';
    constructor(code: 'denied' | 'not-found', message: string);
}
declare module '@deepseek-ai/cordis' {
    interface Context {
        treadmill: TreadmillService;
    }
}
/**
 * Parse the stage table. Ids are unique; dependencies must precede consumers.
 * A disabled dependency disables its consumers. Blank `args` is omitted.
 * @param text - `esteira/pipeline.yaml` content.
 * @returns the stages in file order.
 */
export declare function parsePipeline(text: string): TreadmillStage[];
/** The switches of one stage a client may flip without editing the table by hand. */
export interface StagePatch {
    readonly enabled?: boolean;
    readonly gate?: 'manual' | 'auto';
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
export declare function updateStageInTable(text: string, id: string, patch: StagePatch): string;
/** Host-owned installation: seeding, file access, stage table, and the rules index. */
export declare class TreadmillService extends Service {
    static inject: string[];
    static Config: z<Config>;
    /** Editable installation root. */
    readonly root: string;
    private enabledByConfig;
    private settings;
    private invalidate;
    private provider;
    private rulesIndex;
    /** Seeding and the first rules index; every file operation waits for it. */
    private readonly ready;
    private readonly promptFibers;
    constructor(ctx: Context, config?: Config);
    /**
     * Whether the Treadmill is served: the composition default gated by the user setting.
     * @returns `true` while skills and the prompt section are served.
     */
    enabled(): boolean;
    /**
     * Copy what the vendored installation has and the root lacks: every
     * top-level category, and inside an existing category every direct child
     * (a skill directory, a rule file, a command). Existing entries are never
     * overwritten, so edits survive updates while a new skill still arrives.
     */
    private seed;
    /** Copy `source` to `target` unless `target` exists; `true` when it already existed. */
    private copyMissing;
    private gated;
    /**
     * Resolve one installation-relative path, refusing anything that would
     * leave the root.
     * @param path - relative path as a client sent it.
     * @returns the absolute path inside the root.
     */
    private target;
    /**
     * Read one installation file.
     * @param path - path relative to the root.
     * @returns the file text.
     */
    readFile(path: string): Promise<string>;
    /**
     * Write one installation file, creating parent directories, then refresh
     * the skill catalog and the rules index.
     * @param path - path relative to the root.
     * @param content - new text.
     */
    writeFile(path: string, content: string): Promise<void>;
    /**
     * Update one stage's switches in `esteira/pipeline.yaml`, keeping the file's
     * comments and layout. A disabled stage stays listed and is skipped; a
     * `manual` gate waits for the run action, an `auto` gate follows through.
     * @param id - stage id as the table lists it.
     * @param patch - the switches to set.
     */
    updateStage(id: string, patch: StagePatch): Promise<void>;
    /**
     * The stage table, parsed from `esteira/pipeline.yaml`.
     * @returns the stages, or the parse failure.
     */
    stages(): Promise<{
        stages: TreadmillStage[];
        error?: string;
    }>;
    /**
     * Describe the installation: root, enabled state, stages, and every file.
     * @returns the description.
     */
    describe(): Promise<TreadmillDescription>;
    private files;
    private refreshRulesIndex;
    /**
     * The per-agent prompt section: installation root, rules index, and tool paths.
     * @returns the section text, empty while disabled.
     */
    promptText(): string;
}
/** Cordis plugin name. */
export declare const name = "treadmill";
export default TreadmillService;
