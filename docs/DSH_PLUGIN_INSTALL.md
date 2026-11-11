# DSH plugin package (release candidate)

Requires Node >=24.9.0 and targets DeepSeek Harness 0.2.2-rc.1.
Personal noncommercial use is free with attribution when sharing; commercial
use requires a separate license. See the package LICENSE.

Build a local artifact with `npm ci` and `npm pack`, or use the release candidate tarball. Installing the tarball
with DSH adds the bundle to the profile. Its default patch is empty. In a fresh test DSH
profile, inspect the composed configuration before enabling any Charter
layer. The stock `compaction-basic` should still be enabled.

For example, with a dedicated test DSH home set in PowerShell:

```powershell
dsh plugin --profile headless add 'C:\path\to\zwh-offical-charter-dsh-1.0.0-rc.2.tgz'
$package = Join-Path $env:DSH_HOME 'profiles/headless/node_modules/@zwh-offical/charter-dsh'
dsh headless --patch (Join-Path $package 'charter-enable.patch.yml') --dump-config
```

To try the zero-configuration Charter backend explicitly, use the packaged
`cordis.patch.yml` as a DSH `--patch` argument. This disables the stock
backend for that invocation and installs the excerpt-based Charter backend.
Do not combine it with another replacement patch. To roll back, remove the
patch argument and restart. Use `dsh plugin --profile headless remove @zwh-offical/charter-dsh` to uninstall.
Check the composed configuration again before reusing the profile.

The zero-configuration backend reads session history for compaction. It does
not restore operator-registered constraints. To test that feature, use the
research provider export `@zwh-offical/charter-dsh/provider` instead, in a
separate explicit patch. The provider requires an absolute host-controlled
policy directory and alert file, and DSH model, prompt and persistence
services. It reads registered policies, sends cleaned summary input through
the configured model, and can write alerts and compaction evidence. See
[research configuration](https://github.com/zwh-offical/Charter/blob/main/docs/OPTIONAL_HOST_FEATURES.md)
and the source checkout's reproduction guide. The npm bundle does not
register or export the file deletion tool.

Before publishing, verify in a clean DSH home: stock configuration, explicit
Charter activation, research-mode model compaction with a registered
constraint, a clear error for missing research configuration, and stock
configuration after removing the patch. The compatibility declaration is
intentionally limited to the pinned DSH release.

On Windows, the source checkout's `research/run-windows-pilot.ps1` accepts
`-PluginTarball` to install and exercise the packaged research provider in
the same isolated headless profile. Use an authorized test credential store.

Local acceptance on Windows desktop DSH 0.2.2-rc.1 verified tarball
installation without peer warnings, successful synthetic compaction,
the missing research configuration diagnostic, and return to stock
configuration after removing the patch or uninstalling. The desktop host
supplies the DSH modules, so their npm peer declarations are optional at
install time. Standalone consumers must provide matching peer packages.

The rc.2 packaged research provider also completed two real model-backed
compactions in a fresh headless profile. Independent audit verified the
constraint lineage and its presence in both subsequent model requests, and
the pilot verified the updated policy snapshot after revocation. If the
model reports TRANSPORT, check whether the profile's configured route is
reachable and whether the process inherits a stale proxy. Keep credentials
in the DSH credential store.
