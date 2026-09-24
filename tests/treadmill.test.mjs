import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import SkillRegistry from '@deepseek-ai/dsh-skill'
import Treadmill, { parsePipeline, updateStageInTable, PIPELINE_FILE, TREADMILL_ASSETS } from '../lib/index.js'

async function fixture(t, config = {}) {
  const root = await mkdtemp(join(tmpdir(), 'dsh-treadmill-external-'))
  const ctx = new Context()
  const fibers = []
  t.after(async () => {
    for (const fiber of fibers.reverse()) await fiber.dispose()
    await rm(root, { recursive: true, force: true })
  })
  fibers.push(ctx.plugin(AgentRegistry), ctx.plugin(SkillRegistry))
  const mounted = ctx.plugin(Treadmill, { root: join(root, 'installation'), ...config })
  fibers.push(mounted)
  await mounted
  return { ctx, root }
}

test('built plugin seeds assets and serves skills from the editable installation', async t => {
  const { ctx, root } = await fixture(t)
  const description = await ctx.treadmill.describe()
  assert.equal(description.enabled, true)
  assert.equal(description.stages.find(stage => stage.id === 'deploy').enabled, true)
  const catalog = await ctx.skills.list({ cwd: root })
  for (const name of ['graphify', 'discovery', 'arquitetura', 'redteam', 'deploy']) {
    assert.ok(catalog.some(skill => skill.name === name && skill.provider === 'treadmill'), name)
  }
  assert.match(ctx.treadmill.promptText(), /01-file-size.md/)
  assert.ok((await readFile(join(TREADMILL_ASSETS, PIPELINE_FILE), 'utf8')).includes('40-redteam'))
})

test('stage edits cascade to dependent gates and preserve code review', async t => {
  const { ctx } = await fixture(t)
  await ctx.treadmill.updateStage('40-redteam', { enabled: false })
  const stages = (await ctx.treadmill.stages()).stages
  assert.equal(stages.find(stage => stage.id === '40-redteam').enabled, false)
  assert.equal(stages.find(stage => stage.id === '40-seguranca').enabled, false)
  assert.equal(stages.find(stage => stage.id === '25').enabled, true)
  await assert.rejects(ctx.treadmill.updateStage('40-seguranca', { enabled: true }), /enable required stages first/)
  await ctx.treadmill.updateStage('deploy', { enabled: false })
  assert.equal((await ctx.treadmill.stages()).stages.find(stage => stage.id === 'deploy').enabled, false)
})

test('editable files survive reactivation and paths cannot leave the installation', async t => {
  const { ctx } = await fixture(t)
  await ctx.treadmill.describe()
  await ctx.treadmill.writeFile('rules/custom.md', '# Custom rule\n')
  const root = ctx.treadmill.root
  const other = new Context()
  const fibers = [other.plugin(AgentRegistry), other.plugin(SkillRegistry)]
  t.after(async () => { for (const fiber of fibers.reverse()) await fiber.dispose() })
  const mounted = other.plugin(Treadmill, { root })
  fibers.push(mounted)
  await mounted
  assert.equal(await other.treadmill.readFile('rules/custom.md'), '# Custom rule\n')
  await assert.rejects(other.treadmill.readFile('../outside'), { code: 'denied' })
  await assert.rejects(other.treadmill.readFile('/etc/passwd'), { code: 'denied' })
})

test('disabled plugin exposes no skills or prompt text', async t => {
  const { ctx, root } = await fixture(t, { enabled: false })
  assert.equal((await ctx.treadmill.describe()).enabled, false)
  assert.deepEqual(await ctx.skills.list({ cwd: root }), [])
  assert.equal(ctx.treadmill.promptText(), '')
})

test('pipeline parsing rejects duplicate IDs and forward dependencies', () => {
  const row = '{ id: a, label: A, section: S, skill: a }'
  assert.throws(() => parsePipeline(`schema: 1\nstages: [${row}, ${row}]\n`), /duplicate stage/)
  assert.throws(() => parsePipeline('schema: 1\nstages: [{ id: a, label: A, section: S, skill: a, requires: [b] }]\n'), /earlier stage/)
  assert.throws(() => updateStageInTable('schema: 1\nstages: []\n', 'missing', { enabled: false }), /missing/)
})
