# DSH Treadmill

An installable DeepSeek Harness bundle for the OpenNjord development pipeline. It provides the `treadmill` service, reusable skills, rules, commands, templates and editable stage configuration. The package targets Harness **0.1.6-alpha.2**; newer releases require compatibility validation.

## Installation

Build this package and use Harness Plugin Manager to install its directory or packed tarball as a bundle. Its patch inserts `njord-treadmill`. When using the Persike profile, disable the existing `treadmill` row before enabling this bundle: both provide the same service and skill provider. The aggregate Njord profile owns this transition.

The Host must provide `skills` and `agents`. `settings` enables the user setting, and an Agent's `systemPrompt` receives the rules section. The package contains the backend and assets; a separate Client/API bundle provides visual controls. Replacing a loaded package requires a Harness restart.

## Configuration and data

The plugin accepts `root` (editable installation directory, default `<DSH_HOME>/treadmill`) and `enabled` (default `true`). The `treadmill.enabled` user setting takes precedence when the settings service is present. Existing files in the editable installation survive reseeding; missing files are copied from the packaged assets. Updating the package does not overwrite user edits or existing stage tables.

The installation supplies skills to every project without copying the entire installation into each workspace. Projects keep their own `.spec/` progress and `docs/adrs/` decisions. Pipeline entries describe skills, automatic/manual gates, enabled status and prerequisite stages. Disabling Red Team also disables its dependent security gate; code review remains independent. Deploy starts enabled and can be disabled separately. Re-enabling a prerequisite does not automatically re-enable dependent stages.

The default export is `TreadmillService`. Named exports include `parsePipeline`, `updateStageInTable`, `PIPELINE_FILE`, `TREADMILL_ASSETS`, `TreadmillError` and the TypeScript public types. Consumers should import these from `@persike/dsh-treadmill`.

## Development

Cordis and all Harness packages are exact peer dependencies. They remain imports in emitted JavaScript; the build does not embed another Harness runtime. For the matching built checkout:

```sh
node scripts/prepare-local.mjs /path/to/deepseek-harness
npm run build
npm test
npm pack
```

The preparation script only creates dependency links in this package's `node_modules`; it does not modify the Harness checkout. It rejects mismatched peer versions and existing links to a different installation. Build uses TypeScript with strict checking and produces ESM plus declarations. Tests load that emitted ESM, mount real Cordis/skills services, seed private temporary installations, and check stage dependencies, preserved edits and disabled behavior.

The tracked `lib/` artifacts support Git installation without install-time lifecycle builds. Run the build and tests before committing a release.

## License

MIT; see `LICENSE` and `NOTICE`. Source and OpenNjord assets are included in the package. Embedded attribution in skill and template files is retained.
