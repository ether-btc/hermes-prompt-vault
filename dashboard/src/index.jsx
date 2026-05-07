/**
 * Prompt Vault — Hermes Dashboard Plugin
 *
 * A prompt library for saving, organizing, versioning, and reusing prompts.
 * Uses the Hermes Plugin SDK — no React/UI imports needed.
 */
(function () {
  "use strict";

  const SDK = window.__HERMES_PLUGIN_SDK__;
  if (!SDK) {
    console.error("[prompt-vault] Plugin SDK not available");
    return;
  }

  const { React, hooks, components, utils, fetchJSON } = SDK;
  const { useState, useEffect, useCallback, useMemo, useRef } = hooks;
  const { Card, CardHeader, CardTitle, CardContent, Badge, Button, Input, Label, Separator, Select, SelectOption } = components;
  const { cn, timeAgo } = utils;

  const API = "/api/plugins/prompt-vault";

  // -----------------------------------------------------------------------
  // API helpers
  // -----------------------------------------------------------------------

  async function apiGet(path) {
    return fetchJSON(`${API}${path}`);
  }

  async function apiPost(path, body) {
    return fetchJSON(`${API}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  }

  async function apiPut(path, body) {
    return fetchJSON(`${API}${path}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  }

  async function apiDelete(path) {
    return fetchJSON(`${API}${path}`, { method: "DELETE" });
  }

  // -----------------------------------------------------------------------
  // Icons (inline SVG — no external deps)
  // -----------------------------------------------------------------------

  function Icon({ d, size = 16, className = "" }) {
    return React.createElement("svg", {
      xmlns: "http://www.w3.org/2000/svg", width: size, height: size,
      viewBox: "0 0 24 24", fill: "none", stroke: "currentColor",
      strokeWidth: 2, strokeLinecap: "round", strokeLinejoin: "round",
      className: className,
    }, React.createElement("path", { d }));
  }

  const Icons = {
    search: (p) => React.createElement(Icon, { ...p, d: "M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" }),
    plus: (p) => React.createElement(Icon, { ...p, d: "M12 5v14M5 12h14" }),
    star: (p) => React.createElement(Icon, { ...p, d: "M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" }),
    starFill: (p) => React.createElement("svg", {
      xmlns: "http://www.w3.org/2000/svg", width: p?.size || 16, height: p?.size || 16,
      viewBox: "0 0 24 24", fill: "currentColor", stroke: "currentColor",
      strokeWidth: 2, strokeLinecap: "round", strokeLinejoin: "round",
      className: p?.className || "",
    }, React.createElement("path", { d: "M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" })),
    copy: (p) => React.createElement(Icon, { ...p, d: "M20 9h-7a2 2 0 00-2 2v7M16 2H4a2 2 0 00-2 2v12a2 2 0 002 2h12a2 2 0 002-2V7l-5-5z" }),
    edit: (p) => React.createElement(Icon, { ...p, d: "M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" }),
    trash: (p) => React.createElement(Icon, { ...p, d: "M3 6h18M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2" }),
    x: (p) => React.createElement(Icon, { ...p, d: "M18 6L6 18M6 6l12 12" }),
    clock: (p) => React.createElement(Icon, { ...p, d: "M12 2a10 10 0 100 20 10 10 0 000-20zM12 6v6l4 2" }),
    download: (p) => React.createElement(Icon, { ...p, d: "M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3" }),
    upload: (p) => React.createElement(Icon, { ...p, d: "M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M17 8l-5-5-5 5M12 3v12" }),
    history: (p) => React.createElement(Icon, { ...p, d: "M3 3v5h5M3.05 13A9 9 0 106 5.3L3 8" }),
    tag: (p) => React.createElement(Icon, { ...p, d: "M20.59 13.41l-7.17 7.17a2 2 0 01-2.83 0L2 12V2h10l8.59 8.59a2 2 0 010 2.82z" }),
    folder: (p) => React.createElement(Icon, { ...p, d: "M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z" }),
    check: (p) => React.createElement(Icon, { ...p, d: "M20 6L9 17l-5-5" }),
    zap: (p) => React.createElement(Icon, { ...p, d: "M13 2L3 14h9l-1 8 10-12h-9l1-8z" }),
    book: (p) => React.createElement(Icon, { ...p, d: "M4 19.5A2.5 2.5 0 016.5 17H20M4 19.5A2.5 2.5 0 014 17V5a2 2 0 012-2h14v14H6.5A2.5 2.5 0 004 19.5z" }),
    import: (p) => React.createElement(Icon, { ...p, d: "M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M17 8l-5-5-5 5M12 3v12" }),
  };

  // -----------------------------------------------------------------------
  // Toast notification
  // -----------------------------------------------------------------------

  function Toast({ message, type = "success", onClose }) {
    useEffect(() => {
      const t = setTimeout(onClose, 2500);
      return () => clearTimeout(t);
    }, []);

    const bg = type === "error" ? "pv-toast-error" : "pv-toast-success";

    return React.createElement("div", { className: `pv-toast ${bg}` },
      React.createElement("span", null, message),
      React.createElement("button", { onClick: onClose, className: "pv-toast-close" },
        React.createElement(Icons.x, { size: 14 })
      )
    );
  }

  // -----------------------------------------------------------------------
  // Combobox (custom dropdown for Category field)
  // -----------------------------------------------------------------------

  function Combobox({ value, onChange, options, placeholder }) {
    const [open, setOpen] = useState(false);
    const [query, setQuery] = useState(value || "");
    const [highlightIdx, setHighlightIdx] = useState(-1);
    const wrapRef = useRef(null);
    const inputRef = useRef(null);

    // Sync external value changes
    useEffect(() => { setQuery(value || ""); }, [value]);

    // Filter options
    const filtered = useMemo(() => {
      const q = query.toLowerCase();
      return options.filter((o) => o.toLowerCase().includes(q) && o.toLowerCase() !== q);
    }, [query, options]);

    // Close on outside click
    useEffect(() => {
      if (!open) return;
      function handle(e) {
        if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false);
      }
      document.addEventListener("mousedown", handle);
      return () => document.removeEventListener("mousedown", handle);
    }, [open]);

    function select(val) {
      onChange(val);
      setQuery(val);
      setOpen(false);
      setHighlightIdx(-1);
    }

    function handleKeyDown(e) {
      if (!open) {
        if (e.key === "ArrowDown" || e.key === "ArrowUp") { setOpen(true); e.preventDefault(); }
        return;
      }
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setHighlightIdx((i) => Math.min(i + 1, filtered.length - 1));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setHighlightIdx((i) => Math.max(i - 1, 0));
      } else if (e.key === "Enter") {
        e.preventDefault();
        if (highlightIdx >= 0 && highlightIdx < filtered.length) {
          select(filtered[highlightIdx]);
        } else if (query.trim()) {
          select(query.trim());
        }
      } else if (e.key === "Escape") {
        setOpen(false);
      }
    }

    return React.createElement("div", { ref: wrapRef, className: "pv-combobox" },
      React.createElement("input", {
        ref: inputRef,
        className: "pv-input",
        value: query,
        placeholder: placeholder || "Type to search...",
        onFocus: () => setOpen(true),
        onChange: (e) => {
          setQuery(e.target.value);
          onChange(e.target.value);
          setOpen(true);
          setHighlightIdx(-1);
        },
        onKeyDown: handleKeyDown,
      }),
      open && filtered.length > 0 && React.createElement("div", { className: "pv-combobox-list" },
        filtered.map((opt, i) =>
          React.createElement("div", {
            key: opt,
            className: "pv-combobox-item" + (i === highlightIdx ? " pv-combobox-item-active" : ""),
            onMouseDown: (e) => { e.preventDefault(); select(opt); },
            onMouseEnter: () => setHighlightIdx(i),
          }, opt)
        )
      )
    );
  }

  // -----------------------------------------------------------------------
  // Modal
  // -----------------------------------------------------------------------

  function Modal({ title, children, onClose, wide }) {
    return React.createElement("div", { className: "pv-modal-overlay" },
      React.createElement("div", {
        className: `pv-modal ${wide ? "pv-modal-wide" : ""}`,
      },
        React.createElement("div", { className: "pv-modal-header" },
          React.createElement("h2", { className: "pv-modal-title" }, title),
          React.createElement("button", { onClick: onClose, className: "pv-icon-btn" },
            React.createElement(Icons.x, { size: 18 })
          )
        ),
        React.createElement("div", { className: "pv-modal-body" }, children)
      )
    );
  }

  // -----------------------------------------------------------------------
  // Prompt Form (create / edit)
  // -----------------------------------------------------------------------

  function PromptForm({ prompt, allTags, allCategories, onSave, onCancel }) {
    const [title, setTitle] = useState(prompt?.title || "");
    const [content, setContent] = useState(prompt?.content || "");
    const [description, setDescription] = useState(prompt?.description || "");
    const [category, setCategory] = useState(prompt?.category || "");
    const [tagInput, setTagInput] = useState("");
    const [tags, setTags] = useState(prompt?.tags || []);
    const [saving, setSaving] = useState(false);
    const contentRef = useRef(null);

    useEffect(() => {
      if (contentRef.current) {
        contentRef.current.style.height = "auto";
        contentRef.current.style.height = contentRef.current.scrollHeight + "px";
      }
    }, [content]);

    function addTag(t) {
      const trimmed = t.trim();
      if (trimmed && !tags.includes(trimmed)) {
        setTags([...tags, trimmed]);
      }
      setTagInput("");
    }

    function removeTag(t) {
      setTags(tags.filter((x) => x !== t));
    }

    async function handleSubmit(e) {
      e.preventDefault();
      if (!title.trim() || !content.trim()) return;
      setSaving(true);
      try {
        await onSave({ title: title.trim(), content, description, category, tags });
      } finally {
        setSaving(false);
      }
    }

    return React.createElement("form", { onSubmit: handleSubmit, className: "pv-form" },
      React.createElement("div", { className: "pv-field" },
        React.createElement("label", { className: "pv-label" }, "Title"),
        React.createElement("input", {
          className: "pv-input", value: title,
          onChange: (e) => setTitle(e.target.value),
          placeholder: "e.g. Code Review Checklist",
          autoFocus: true,
        })
      ),
      React.createElement("div", { className: "pv-field" },
        React.createElement("label", { className: "pv-label" }, "Prompt"),
        React.createElement("textarea", {
          ref: contentRef,
          className: "pv-textarea", value: content,
          onChange: (e) => setContent(e.target.value),
          placeholder: "Write your prompt here...",
          rows: 6,
        })
      ),
      React.createElement("div", { className: "pv-field" },
        React.createElement("label", { className: "pv-label" }, "Description"),
        React.createElement("input", {
          className: "pv-input", value: description,
          onChange: (e) => setDescription(e.target.value),
          placeholder: "Brief description (optional)",
        })
      ),
      React.createElement("div", { className: "pv-form-row" },
        React.createElement("div", { className: "pv-field pv-field-grow" },
          React.createElement("label", { className: "pv-label" }, "Category"),
          React.createElement(Combobox, {
            value: category,
            onChange: setCategory,
            options: allCategories,
            placeholder: "e.g. Coding, Writing, Research",
          })
        )
      ),
      React.createElement("div", { className: "pv-field" },
        React.createElement("label", { className: "pv-label" }, "Tags"),
        React.createElement("div", { className: "pv-tags-input" },
          tags.map((t) =>
            React.createElement("span", { key: t, className: "pv-tag pv-tag-removable", onClick: () => removeTag(t) },
              t, React.createElement(Icons.x, { size: 12 })
            )
          ),
          React.createElement("input", {
            className: "pv-input pv-input-inline", value: tagInput,
            onChange: (e) => setTagInput(e.target.value),
            onKeyDown: (e) => {
              if (e.key === "Enter" || e.key === ",") { e.preventDefault(); addTag(tagInput); }
              if (e.key === "Backspace" && !tagInput && tags.length) removeTag(tags[tags.length - 1]);
            },
            placeholder: tags.length ? "" : "Add tags...",
          })
        )
      ),
      React.createElement("div", { className: "pv-form-actions" },
        React.createElement("button", { type: "button", onClick: onCancel, className: "pv-btn pv-btn-ghost" }, "Cancel"),
        React.createElement("button", {
          type: "submit", className: "pv-btn pv-btn-primary",
          disabled: saving || !title.trim() || !content.trim(),
        }, saving ? "Saving..." : (prompt ? "Update" : "Save Prompt"))
      )
    );
  }

  // -----------------------------------------------------------------------
  // Version History
  // -----------------------------------------------------------------------

  function VersionHistory({ promptId, onRestore }) {
    const [versions, setVersions] = useState([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
      apiGet(`/prompts/${promptId}/versions`).then(setVersions).finally(() => setLoading(false));
    }, [promptId]);

    if (loading) return React.createElement("div", { className: "pv-loading" }, "Loading versions...");

    if (!versions.length) {
      return React.createElement("div", { className: "pv-empty-sm" }, "No previous versions yet. Versions are saved automatically when you edit a prompt.");
    }

    return React.createElement("div", { className: "pv-versions" },
      versions.map((v) =>
        React.createElement("div", { key: v.id, className: "pv-version-card" },
          React.createElement("div", { className: "pv-version-meta" },
            React.createElement("span", { className: "pv-version-date" },
              React.createElement(Icons.clock, { size: 12 }), " ",
              timeAgo(v.created_at)
            ),
            v.note && React.createElement("span", { className: "pv-version-note" }, v.note)
          ),
          React.createElement("div", { className: "pv-version-preview" },
            v.content.substring(0, 200) + (v.content.length > 200 ? "..." : "")
          ),
          React.createElement("button", {
            className: "pv-btn pv-btn-sm pv-btn-ghost",
            onClick: () => onRestore(promptId, v.id),
          }, "Restore this version")
        )
      )
    );
  }

  // -----------------------------------------------------------------------
  // Prompt Card
  // -----------------------------------------------------------------------

  function PromptCard({ prompt, onEdit, onDelete, onCopy, onToggleFav, onView }) {
    const [copied, setCopied] = useState(false);

    function handleCopy(e) {
      e.stopPropagation();
      navigator.clipboard.writeText(prompt.content).then(() => {
        setCopied(true);
        onCopy(prompt.id);
        setTimeout(() => setCopied(false), 1500);
      });
    }

    const preview = prompt.content.substring(0, 150).replace(/\n/g, " ");

    return React.createElement("div", { className: "pv-prompt-card", onClick: () => onView(prompt) },
      React.createElement("div", { className: "pv-card-top" },
        React.createElement("div", { className: "pv-card-title-row" },
          React.createElement("h3", { className: "pv-card-title" }, prompt.title),
          React.createElement("button", {
            className: `pv-icon-btn ${prompt.favorite ? "pv-fav-active" : ""}`,
            onClick: (e) => { e.stopPropagation(); onToggleFav(prompt); },
            title: prompt.favorite ? "Unfavorite" : "Favorite",
          }, prompt.favorite
            ? React.createElement(Icons.starFill, { size: 16 })
            : React.createElement(Icons.star, { size: 16 })
          )
        ),
        prompt.description && React.createElement("p", { className: "pv-card-desc" }, prompt.description)
      ),
      React.createElement("div", { className: "pv-card-preview" }, preview + (prompt.content.length > 150 ? "..." : "")),
      React.createElement("div", { className: "pv-card-footer" },
        React.createElement("div", { className: "pv-card-tags" },
          prompt.category && React.createElement("span", { className: "pv-tag pv-tag-category" }, prompt.category),
          prompt.tags.slice(0, 3).map((t) =>
            React.createElement("span", { key: t, className: "pv-tag" }, t)
          ),
          prompt.tags.length > 3 && React.createElement("span", { className: "pv-tag pv-tag-more" }, `+${prompt.tags.length - 3}`)
        ),
        React.createElement("div", { className: "pv-card-actions" },
          React.createElement("button", {
            className: "pv-icon-btn pv-icon-btn-sm",
            onClick: handleCopy,
            title: copied ? "Copied!" : "Copy to clipboard",
          }, copied
            ? React.createElement(Icons.check, { size: 14, className: "pv-color-green" })
            : React.createElement(Icons.copy, { size: 14 })
          ),
          React.createElement("button", {
            className: "pv-icon-btn pv-icon-btn-sm",
            onClick: (e) => { e.stopPropagation(); onEdit(prompt); },
            title: "Edit",
          }, React.createElement(Icons.edit, { size: 14 })),
          React.createElement("button", {
            className: "pv-icon-btn pv-icon-btn-sm pv-icon-btn-danger",
            onClick: (e) => { e.stopPropagation(); onDelete(prompt); },
            title: "Delete",
          }, React.createElement(Icons.trash, { size: 14 }))
        )
      ),
      prompt.run_count > 0 && React.createElement("div", { className: "pv-card-runs" },
        React.createElement(Icons.zap, { size: 12 }), ` Used ${prompt.run_count} time${prompt.run_count !== 1 ? "s" : ""}`
      )
    );
  }

  // -----------------------------------------------------------------------
  // Detail View
  // -----------------------------------------------------------------------

  function PromptDetail({ prompt, onBack, onEdit, onRestore }) {
    const [showVersions, setShowVersions] = useState(false);
    const [copied, setCopied] = useState(false);

    function handleCopy() {
      navigator.clipboard.writeText(prompt.content).then(() => {
        setCopied(true);
        apiPost(`/prompts/${prompt.id}/run`).catch(() => {});
        setTimeout(() => setCopied(false), 1500);
      });
    }

    return React.createElement("div", { className: "pv-detail" },
      React.createElement("div", { className: "pv-detail-nav" },
        React.createElement("button", { className: "pv-btn pv-btn-ghost pv-btn-sm", onClick: onBack },
          "Back to list"
        ),
        React.createElement("div", { className: "pv-detail-actions" },
          React.createElement("button", {
            className: "pv-btn pv-btn-ghost pv-btn-sm",
            onClick: () => setShowVersions(!showVersions),
          },
            React.createElement(Icons.history, { size: 14 }), " ",
            showVersions ? "Hide" : "History"
          ),
          React.createElement("button", {
            className: "pv-btn pv-btn-ghost pv-btn-sm",
            onClick: () => onEdit(prompt),
          },
            React.createElement(Icons.edit, { size: 14 }), " Edit"
          ),
          React.createElement("button", {
            className: `pv-btn pv-btn-sm ${copied ? "pv-btn-success" : "pv-btn-primary"}`,
            onClick: handleCopy,
          },
            copied
              ? [React.createElement(Icons.check, { size: 14, key: "c" }), " Copied!"]
              : [React.createElement(Icons.copy, { size: 14, key: "c" }), " Copy & Use"]
          )
        )
      ),
      React.createElement("div", { className: "pv-detail-header" },
        React.createElement("h1", { className: "pv-detail-title" }, prompt.title),
        prompt.description && React.createElement("p", { className: "pv-detail-desc" }, prompt.description),
        React.createElement("div", { className: "pv-detail-meta" },
          prompt.category && React.createElement("span", { className: "pv-tag pv-tag-category" }, prompt.category),
          prompt.tags.map((t) => React.createElement("span", { key: t, className: "pv-tag" }, t)),
          React.createElement("span", { className: "pv-detail-date" },
            "Created ", timeAgo(prompt.created_at)
          ),
          prompt.updated_at !== prompt.created_at && React.createElement("span", { className: "pv-detail-date" },
            "Updated ", timeAgo(prompt.updated_at)
          ),
          prompt.run_count > 0 && React.createElement("span", { className: "pv-detail-runs" },
            React.createElement(Icons.zap, { size: 13 }), ` Used ${prompt.run_count}x`
          )
        )
      ),
      React.createElement(Separator, null),
      React.createElement("div", { className: "pv-detail-content" },
        React.createElement("pre", { className: "pv-prompt-text" }, prompt.content)
      ),
      showVersions && React.createElement(React.Fragment, null,
        React.createElement(Separator, null),
        React.createElement("h3", { className: "pv-section-title" },
          React.createElement(Icons.history, { size: 16 }), " Version History"
        ),
        React.createElement(VersionHistory, { promptId: prompt.id, onRestore: onRestore })
      )
    );
  }

  // -----------------------------------------------------------------------
  // Import/Export
  // -----------------------------------------------------------------------

  function ImportExport({ onImport, onClose }) {
    const [tab, setTab] = useState("export");
    const [exportData, setExportData] = useState(null);
    const [importText, setImportText] = useState("");
    const [loading, setLoading] = useState(false);

    useEffect(() => {
      if (tab === "export") {
        setLoading(true);
        apiGet("/export").then(setExportData).finally(() => setLoading(false));
      }
    }, [tab]);

    function handleExport() {
      if (!exportData) return;
      const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = "prompt-vault-export.json"; a.click();
      URL.revokeObjectURL(url);
    }

    async function handleImport() {
      try {
        const data = JSON.parse(importText);
        if (!data.prompts || !Array.isArray(data.prompts)) throw new Error("Invalid format");
        setLoading(true);
        const result = await apiPost("/import", data);
        onImport(result.imported);
        onClose();
      } catch (e) {
        alert("Import failed: " + e.message);
      } finally {
        setLoading(false);
      }
    }

    return React.createElement("div", { className: "pv-import-export" },
      React.createElement("div", { className: "pv-ie-tabs" },
        React.createElement("button", {
          className: `pv-btn pv-btn-sm ${tab === "export" ? "pv-btn-primary" : "pv-btn-ghost"}`,
          onClick: () => setTab("export"),
        }, React.createElement(Icons.download, { size: 14 }), " Export"),
        React.createElement("button", {
          className: `pv-btn pv-btn-sm ${tab === "import" ? "pv-btn-primary" : "pv-btn-ghost"}`,
          onClick: () => setTab("import"),
        }, React.createElement(Icons.upload, { size: 14 }), " Import")
      ),
      tab === "export" && React.createElement("div", null,
        loading ? React.createElement("div", { className: "pv-loading" }, "Loading...") :
        React.createElement("div", null,
          React.createElement("p", { className: "pv-muted" },
            exportData ? `${exportData.prompts.length} prompts ready to export` : "No prompts to export"
          ),
          React.createElement("button", {
            className: "pv-btn pv-btn-primary",
            onClick: handleExport,
            disabled: !exportData || !exportData.prompts.length,
          }, "Download JSON")
        )
      ),
      tab === "import" && React.createElement("div", null,
        React.createElement("p", { className: "pv-muted" }, "Paste a Prompt Vault JSON export:"),
        React.createElement("textarea", {
          className: "pv-textarea", value: importText,
          onChange: (e) => setImportText(e.target.value),
          placeholder: '{ "prompts": [...] }',
          rows: 10,
        }),
        React.createElement("button", {
          className: "pv-btn pv-btn-primary",
          onClick: handleImport,
          disabled: !importText.trim() || loading,
          style: { marginTop: "0.75rem" },
        }, loading ? "Importing..." : "Import Prompts")
      )
    );
  }

  // -----------------------------------------------------------------------
  // Main Plugin Component
  // -----------------------------------------------------------------------

  function PromptVault() {
    const [prompts, setPrompts] = useState([]);
    const [total, setTotal] = useState(0);
    const [allTags, setAllTags] = useState([]);
    const [allCategories, setAllCategories] = useState([]);
    const [stats, setStats] = useState({});
    const [search, setSearch] = useState("");
    const [filterTag, setFilterTag] = useState("");
    const [filterCategory, setFilterCategory] = useState("");
    const [showFavOnly, setShowFavOnly] = useState(false);
    const [loading, setLoading] = useState(true);
    const [view, setView] = useState("list"); // list | detail | create
    const [activePrompt, setActivePrompt] = useState(null);
    const [editingPrompt, setEditingPrompt] = useState(null);
    const [toast, setToast] = useState(null);
    const [showImportExport, setShowImportExport] = useState(false);

    const loadPrompts = useCallback(async () => {
      setLoading(true);
      try {
        const params = new URLSearchParams();
        if (search) params.set("search", search);
        if (filterTag) params.set("tag", filterTag);
        if (filterCategory) params.set("category", filterCategory);
        if (showFavOnly) params.set("favorite", "true");

        const data = await apiGet(`/prompts?${params.toString()}`);
        setPrompts(data.prompts);
        setTotal(data.total);
        setAllTags(data.all_tags);
        setAllCategories(data.all_categories);
      } catch (e) {
        console.error("[prompt-vault] Failed to load:", e);
      } finally {
        setLoading(false);
      }
    }, [search, filterTag, filterCategory, showFavOnly]);

    useEffect(() => { loadPrompts(); }, [loadPrompts]);

    useEffect(() => {
      apiGet("/stats").then(setStats).catch(() => {});
    }, []);

    function showToast(message, type = "success") {
      setToast({ message, type });
    }

    async function handleCreate(data) {
      await apiPost("/prompts", data);
      showToast("Prompt saved!");
      setView("list");
      loadPrompts();
      apiGet("/stats").then(setStats).catch(() => {});
    }

    async function handleUpdate(data) {
      await apiPut(`/prompts/${editingPrompt.id}`, data);
      showToast("Prompt updated!");
      setEditingPrompt(null);
      setView("list");
      loadPrompts();
    }

    async function handleDelete(prompt) {
      if (!confirm(`Delete "${prompt.title}"?`)) return;
      await apiDelete(`/prompts/${prompt.id}`);
      showToast("Prompt deleted");
      setView("list");
      loadPrompts();
      apiGet("/stats").then(setStats).catch(() => {});
    }

    async function handleToggleFav(prompt) {
      await apiPut(`/prompts/${prompt.id}`, { favorite: !prompt.favorite });
      loadPrompts();
    }

    async function handleCopy(promptId) {
      await apiPost(`/prompts/${promptId}/run`).catch(() => {});
      apiGet("/stats").then(setStats).catch(() => {});
    }

    async function handleRestore(promptId, versionId) {
      await apiPost(`/prompts/${promptId}/versions/${versionId}/restore`);
      showToast("Version restored!");
      // Refresh the detail view
      const updated = await apiGet(`/prompts/${promptId}`);
      setActivePrompt(updated);
      loadPrompts();
    }

    function handleViewPrompt(prompt) {
      setActivePrompt(prompt);
      setView("detail");
    }

    function handleEditPrompt(prompt) {
      setEditingPrompt(prompt);
      setView("create");
    }

    const filteredCount = prompts.length;

    return React.createElement("div", { className: "pv-container" },
      // Toast
      toast && React.createElement(Toast, {
        message: toast.message, type: toast.type,
        onClose: () => setToast(null),
      }),

      // Header
      React.createElement("div", { className: "pv-header" },
        React.createElement("div", { className: "pv-header-left" },
          React.createElement("h1", { className: "pv-title" },
            React.createElement(Icons.book, { size: 24 }), " Prompt Vault"
          ),
          React.createElement("div", { className: "pv-stats" },
            React.createElement("span", null,
              React.createElement(Icons.book, { size: 13 }), ` ${stats.total_prompts || 0} prompts`
            ),
            React.createElement("span", null,
              React.createElement(Icons.starFill, { size: 13 }), ` ${stats.total_favorites || 0} favs`
            ),
            React.createElement("span", null,
              React.createElement(Icons.zap, { size: 13 }), ` ${stats.total_runs || 0} runs`
            )
          )
        ),
        React.createElement("div", { className: "pv-header-right" },
          React.createElement("button", {
            className: "pv-btn pv-btn-ghost pv-btn-sm",
            onClick: () => setShowImportExport(true),
          }, React.createElement(Icons.import, { size: 14 }), " Import/Export"),
          React.createElement("button", {
            className: "pv-btn pv-btn-primary",
            onClick: () => { setEditingPrompt(null); setView("create"); },
          }, React.createElement(Icons.plus, { size: 16 }), " New Prompt")
        )
      ),

      // Main content
      view === "list" && React.createElement(React.Fragment, null,
        // Search & filters
        React.createElement("div", { className: "pv-toolbar" },
          React.createElement("div", { className: "pv-search-wrapper" },
            React.createElement(Icons.search, { size: 16, className: "pv-search-icon" }),
            React.createElement("input", {
              className: "pv-input pv-search",
              value: search,
              onChange: (e) => setSearch(e.target.value),
              placeholder: "Search prompts...",
            })
          ),
          React.createElement("div", { className: "pv-filters" },
            allCategories.length > 0 && React.createElement("select", {
              className: "pv-select",
              value: filterCategory,
              onChange: (e) => setFilterCategory(e.target.value),
            },
              React.createElement("option", { value: "" }, "All Categories"),
              allCategories.map((c) => React.createElement("option", { key: c, value: c }, c))
            ),
            allTags.length > 0 && React.createElement("select", {
              className: "pv-select",
              value: filterTag,
              onChange: (e) => setFilterTag(e.target.value),
            },
              React.createElement("option", { value: "" }, "All Tags"),
              allTags.map((t) => React.createElement("option", { key: t, value: t }, t))
            ),
            React.createElement("button", {
              className: `pv-btn pv-btn-sm ${showFavOnly ? "pv-btn-primary" : "pv-btn-ghost"}`,
              onClick: () => setShowFavOnly(!showFavOnly),
            },
              React.createElement(showFavOnly ? Icons.starFill : Icons.star, { size: 14 }),
              " Favorites"
            )
          )
        ),

        // Results count
        (search || filterTag || filterCategory || showFavOnly) &&
          React.createElement("div", { className: "pv-results-count" },
            `${filteredCount} of ${total} prompts`
          ),

        // Prompt grid
        loading
          ? React.createElement("div", { className: "pv-loading" }, "Loading prompts...")
          : prompts.length === 0
            ? React.createElement("div", { className: "pv-empty" },
                React.createElement(Icons.book, { size: 48, className: "pv-empty-icon" }),
                React.createElement("h3", null, "No prompts yet"),
                React.createElement("p", null, "Save your first prompt to build your library."),
                React.createElement("button", {
                  className: "pv-btn pv-btn-primary",
                  onClick: () => { setEditingPrompt(null); setView("create"); },
                }, React.createElement(Icons.plus, { size: 16 }), " Create First Prompt")
              )
            : React.createElement("div", { className: "pv-grid" },
                prompts.map((p) =>
                  React.createElement(PromptCard, {
                    key: p.id, prompt: p,
                    onEdit: handleEditPrompt,
                    onDelete: handleDelete,
                    onCopy: handleCopy,
                    onToggleFav: handleToggleFav,
                    onView: handleViewPrompt,
                  })
                )
              )
      ),

      // Detail view
      view === "detail" && activePrompt && React.createElement(PromptDetail, {
        prompt: activePrompt,
        onBack: () => { setView("list"); loadPrompts(); },
        onEdit: handleEditPrompt,
        onRestore: handleRestore,
      }),

      // Create / Edit form
      view === "create" && React.createElement(Modal, {
        title: editingPrompt ? "Edit Prompt" : "New Prompt",
        onClose: () => { setEditingPrompt(null); setView("list"); },
        wide: true,
      },
        React.createElement(PromptForm, {
          prompt: editingPrompt,
          allTags, allCategories,
          onSave: editingPrompt ? handleUpdate : handleCreate,
          onCancel: () => { setEditingPrompt(null); setView("list"); },
        })
      ),

      // Import/Export modal
      showImportExport && React.createElement(Modal, {
        title: "Import / Export Prompts",
        onClose: () => setShowImportExport(false),
      },
        React.createElement(ImportExport, {
          onImport: (count) => { showToast(`Imported ${count} prompts!`); loadPrompts(); },
          onClose: () => setShowImportExport(false),
        })
      )
    );
  }

  // -----------------------------------------------------------------------
  // Register
  // -----------------------------------------------------------------------

  window.__HERMES_PLUGINS__.register("prompt-vault", PromptVault);
})();
