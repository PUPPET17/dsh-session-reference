# dsh-session-reference

An independently installable DeepSeek Harness bundle for read-only cross-session references.

The package owns the complete feature:

- the `@` menu source over the current DSH Home session list;
- same-working-directory-first candidate ranking;
- the responsive `@title` capsule inserted through `ReferenceInsert` and its codec;
- canonical `dsh-session:` mention serialization for copy, persistence, and submission;
- send-time current-surface reads, bounded projection, and durable untrusted recall context.

The DeepSeek Harness repository supplies only generic input-source, reference-presentation, session-query, and pre-step extension points. It does not mount this feature by default.

Requires DeepSeek Harness `0.1.0-rc.5`. The DSH launcher supplies the compatible Host and browser services through its maintained profile fallback; the peer entries remain optional to package managers because a profile does not install a second copy of those in-box packages.

## 安装

Build and pack the plugin:

```sh
pnpm install
pnpm run pack:plugin
```

Install the generated tarball into a Web profile:

```sh
dsh plugin --profile web add ./dsh-session-reference-0.1.0.tgz
dsh --profile web --dump-config
dsh --profile web
```

Remove it with:

```sh
dsh plugin --profile web remove dsh-session-reference
```

The default limits are three references per message and 65,536 UTF-8 bytes per referenced source. Override the single `session-reference` row in the profile's `cordis.patch.yml` when a deployment needs smaller bounds.
