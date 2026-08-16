window.__ModuleLoader__.load({
	id: "dsh-session-reference",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		//#region src/client.ts
		/** URI scheme shared with dsh-session-reference's canonical mention format. */
		const SESSION_REFERENCE_SCHEME = "dsh-session:";
		/** Encode a session id as the canonical `dsh-session:<base64url(JSON.stringify(id))>` URI. */
		function encodeSessionUri(sessionId) {
			const bytes = new TextEncoder().encode(JSON.stringify(sessionId));
			let binary = "";
			for (const byte of bytes) binary += String.fromCharCode(byte);
			const base64 = btoa(binary);
			return `${SESSION_REFERENCE_SCHEME}${base64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")}`;
		}
		/** Escape `\` and `]` so a label round-trips through the Markdown mention. */
		function escapeLabel(label) {
			return label.replace(/[\\\]]/g, (match) => `\\${match}`);
		}
		/** Render the canonical `@[label](dsh-session:…)` mention the host half parses. */
		function formatMention(sessionId, label) {
			return `@[${escapeLabel(label)}](${encodeSessionUri(sessionId)})`;
		}
		/** Locale namespace owned by this external feature. */
		const LOCALE_NAMESPACE = "dsh-session-reference";
		/** Required services: the trigger roster, session list, and source-owned localization. */
		const inject = [
			"inputTriggers",
			"sessions",
			"locale"
		];
		/**
		* Client plugin body: register the '@' session-reference source over the root session list.
		* @param ctx - client root context.
		*/
		function apply(ctx) {
			const sessions = ctx.sessions;
			const inputTriggers = ctx.get("inputTriggers");
			ctx.effect(() => ctx.locale.register(LOCALE_NAMESPACE, {
				zh: { menu: "会话" },
				en: { menu: "Sessions" }
			}), "dsh-session-reference: menu dictionaries");
			const t = ctx.locale.bind(LOCALE_NAMESPACE);
			const byName = /* @__PURE__ */ new Map();
			const source = {
				trigger: "@",
				name: "session-reference",
				order: 1,
				groupLabel: () => t("menu"),
				candidates(session, { query }) {
					const snapshot = sessions.list.getSnapshot();
					const currentCwd = snapshot.byId[session.sessionId]?.cwd;
					const needle = query.toLowerCase();
					const titleCounts = /* @__PURE__ */ new Map();
					const rows = [];
					for (const row of Object.values(snapshot.byId)) {
						if (row.id === session.sessionId || row.blank) continue;
						if (needle !== "" && !`${row.displayTitle} ${row.cwd ?? ""} ${row.id}`.toLowerCase().includes(needle)) continue;
						rows.push(row);
						titleCounts.set(row.displayTitle, (titleCounts.get(row.displayTitle) ?? 0) + 1);
					}
					const rank = (row) => currentCwd !== void 0 && row.cwd === currentCwd ? 0 : row.cwd === void 0 ? 1 : 2;
					rows.sort((a, b) => rank(a) - rank(b) || a.displayTitle.localeCompare(b.displayTitle));
					byName.clear();
					return Promise.resolve(rows.map((row) => {
						const name = (titleCounts.get(row.displayTitle) ?? 0) > 1 ? `${row.displayTitle} · ${row.id}` : row.displayTitle;
						byName.set(name, {
							sessionId: row.id,
							label: row.displayTitle
						});
						return {
							name,
							description: row.cwd ?? row.id
						};
					}));
				},
				onPick({ candidate }) {
					const hit = byName.get(candidate.name);
					if (hit === void 0) return void 0;
					const mention = formatMention(hit.sessionId, hit.label);
					return { insert: {
						source: "session-reference",
						ref: mention,
						label: hit.label,
						clipboardText: mention,
						presentation: {
							variant: "capsule",
							sigil: "@"
						}
					} };
				},
				codec: {
					clipboardText: (ref) => ref,
					serialize(ref, signal) {
						if (signal.aborted) {
							const reason = signal.reason;
							return Promise.reject(reason instanceof Error ? reason : /* @__PURE__ */ new Error("session reference serialization aborted"));
						}
						return Promise.resolve(ref);
					}
				}
			};
			ctx.effect(() => inputTriggers.registerSource(source), "dsh-session-reference: @ source");
		}
		//#endregion
		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});

//# sourceMappingURL=client.js.map