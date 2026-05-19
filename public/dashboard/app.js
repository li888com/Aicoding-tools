const page = document.body.dataset.page ?? "overview";

const state = {
  filters: null,
  summary: null,
  requirements: [],
  requirementRecords: [],
  models: [],
  timeline: [],
  rounds: [],
  editingRequirementId: null,
  editingRoundId: null,
  localLogFiles: [],
  localLogScan: null,
  selectedLogFile: null
};

const formatNumber = new Intl.NumberFormat("zh-CN");
const formatDecimal = new Intl.NumberFormat("zh-CN", {
  maximumFractionDigits: 1
});
const formatDateTime = new Intl.DateTimeFormat("zh-CN", {
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit"
});

const statusLabels = {
  active: "进行中",
  done: "已完成",
  archived: "已归档"
};

const $ = (selector) => document.querySelector(selector);

async function api(path, options = {}) {
  const response = await fetch(path, options);
  if (response.status === 401) {
    location.href = "/login";
    throw new Error("Unauthorized");
  }
  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || `Request failed: ${response.status}`);
  }
  return response.json();
}

function renderNav() {
  document.querySelectorAll("[data-nav]").forEach((link) => {
    link.classList.toggle("active", link.dataset.nav === page);
  });
}

function renderFilters() {
  const container = $("#filters");
  if (!container) return;

  container.innerHTML = `
    <label>
      起始日期
      <input id="fromFilter" type="date">
    </label>
    <label>
      结束日期
      <input id="toFilter" type="date">
    </label>
    <label>
      模型
      <select id="modelFilter">
        <option value="">全部模型</option>
      </select>
    </label>
    <label>
      需求
      <select id="requirementFilter">
        <option value="">全部需求</option>
      </select>
    </label>
    <label>
      客户端
      <select id="clientFilter">
        <option value="">全部客户端</option>
      </select>
    </label>
    <label>
      Token status
      <select id="tokenStatusFilter">
        <option value="">All token status</option>
      </select>
    </label>
    <label class="checkbox-label">
      <input id="includeRevertedFilter" type="checkbox">
      包含撤销轮次
    </label>
    <button id="refreshButton" type="button">刷新</button>
  `;

  fillSelect($("#modelFilter"), state.filters?.models ?? [], "全部模型", (value) => value);
  fillSelect(
    $("#requirementFilter"),
    state.filters?.requirements ?? [],
    "全部需求",
    (value) => value.label,
    (value) => value.id === null ? "null" : String(value.id)
  );
  fillSelect($("#clientFilter"), state.filters?.clients ?? [], "全部客户端", (value) => value);
  fillSelect($("#tokenStatusFilter"), state.filters?.tokenSyncStatuses ?? [], "All token status", (value) => value);
  applyUrlFilters();

  $("#refreshButton").addEventListener("click", () => {
    void loadPageData();
  });

  for (const selector of ["#fromFilter", "#toFilter", "#modelFilter", "#requirementFilter", "#clientFilter", "#tokenStatusFilter", "#includeRevertedFilter"]) {
    $(selector).addEventListener("change", () => {
      updateUrlFromFilters();
      void loadPageData();
    });
  }
}

function fillSelect(select, values, firstLabel, labelOf, valueOf = (value) => value) {
  if (!select) return;
  const currentValue = select.value;
  select.innerHTML = "";
  const first = document.createElement("option");
  first.value = "";
  first.textContent = firstLabel;
  select.append(first);

  for (const value of values) {
    const option = document.createElement("option");
    option.value = valueOf(value);
    option.textContent = labelOf(value);
    select.append(option);
  }

  if ([...select.options].some((option) => option.value === currentValue)) {
    select.value = currentValue;
  }
}

function applyUrlFilters() {
  const params = new URLSearchParams(location.search);
  setValue("#fromFilter", params.get("from") ?? "");
  setValue("#toFilter", params.get("to") ?? "");
  setValue("#modelFilter", params.get("model") ?? "");
  setValue("#requirementFilter", params.get("requirementId") ?? "");
  setValue("#clientFilter", params.get("client") ?? "");
  setValue("#tokenStatusFilter", params.get("tokenSyncStatus") ?? "");
  const includeReverted = $("#includeRevertedFilter");
  if (includeReverted) includeReverted.checked = params.get("includeReverted") === "true";
}

function setValue(selector, value) {
  const element = $(selector);
  if (element) element.value = value;
}

function filterQuery() {
  const params = collectFilterParams();
  return params.toString() ? `?${params.toString()}` : "";
}

function collectFilterParams() {
  const params = new URLSearchParams();
  const from = $("#fromFilter")?.value;
  const to = $("#toFilter")?.value;
  const model = $("#modelFilter")?.value;
  const requirementId = $("#requirementFilter")?.value;
  const client = $("#clientFilter")?.value;
  const tokenSyncStatus = $("#tokenStatusFilter")?.value;

  if (from) params.set("from", from);
  if (to) params.set("to", to);
  if (model) params.set("model", model);
  if (requirementId) params.set("requirementId", requirementId);
  if (client) params.set("client", client);
  if (tokenSyncStatus) params.set("tokenSyncStatus", tokenSyncStatus);
  if ($("#includeRevertedFilter")?.checked) params.set("includeReverted", "true");

  return params;
}

function updateUrlFromFilters() {
  if (!$("#filters")) return;
  const query = filterQuery();
  history.replaceState(null, "", `${location.pathname}${query}`);
}

async function loadFilters() {
  state.filters = await api("/api/filters");
}

async function loadPageData() {
  const query = filterQuery();

  if (page === "overview") {
    const [summary, requirements, models] = await Promise.all([
      api(`/api/summary${query}`),
      api(`/api/requirements${query}`),
      api(`/api/models${query}`)
    ]);
    state.summary = summary;
    state.requirements = requirements;
    state.models = models;
  } else if (page === "requirements") {
    state.requirements = await api(`/api/requirements${query}`);
  } else if (page === "models") {
    state.models = await api(`/api/models${query}`);
  } else if (page === "timeline") {
    state.timeline = await api(`/api/timeline${query}`);
  } else if (page === "rounds") {
    state.rounds = await api(`/api/rounds${query}`);
  } else if (page === "requirement-maintenance") {
    state.requirementRecords = await api("/api/requirement-records");
  } else if (page === "local-logs") {
    await loadLocalLogFiles();
  }

  renderPage();
}

async function loadLocalLogFiles() {
  const params = new URLSearchParams();
  params.set("client", $("#logClientInput")?.value || "codex");
  params.set("limit", $("#logLimitInput")?.value || "50");
  const search = $("#logSearchInput")?.value?.trim();
  if (search) params.set("search", search);

  const payload = await api(`/api/local-logs/files?${params.toString()}`);
  state.localLogFiles = payload.files ?? [];
  state.localLogScan = payload;
}

function renderPage() {
  if ($("#kpiGrid")) renderKpis();
  if ($("#tokenQualityGrid")) renderTokenQualityDashboard();
  if ($("#requirementChart")) renderRequirementChart();
  if ($("#modelChart")) renderModelChart();
  if ($("#timelineChart")) renderTimeline();
  if ($("#requirementsTable")) renderRequirementTableDashboard();
  if ($("#modelsTable")) renderModelTable();
  if ($("#roundsTable")) renderRoundsTableDashboard();
  if ($("#requirementRecordsTable")) renderRequirementRecords();
  if ($("#localLogFilesTable")) renderLocalLogFiles();
}

function renderTokenQuality() {
  const summary = state.summary;
  if (!summary) return;
  const cards = [
    ["真实 Token 轮次", formatNumber.format(summary.tokenSyncedRounds ?? 0), "已由 payload 或日志确认"],
    ["Claude JSONL", formatNumber.format(summary.claudeTokenRounds ?? 0), "精确 input/output usage"],
    ["Codex 日志", formatNumber.format(summary.codexTokenRounds ?? 0), "基于累计 token 差值"],
    ["同步异常", formatNumber.format(summary.tokenSyncIssueRounds ?? 0), "未找到、多候选或失败"]
  ];

  $("#tokenQualityGrid").innerHTML = cards.map(([label, value, detail]) => `
    <article class="quality-card">
      <span>${escapeHtml(label)}</span>
      <strong>${escapeHtml(value)}</strong>
      <small>${escapeHtml(detail)}</small>
    </article>
  `).join("");
}

function renderTokenQualityDashboard() {
  const summary = state.summary;
  if (!summary) return;
  const cards = [
    ["Token completeness", formatPercent(summary.tokenCompletenessRate), `${formatNumber.format(summary.tokenSyncedRounds ?? 0)} synced rounds`],
    ["Pending", formatNumber.format(summary.tokenPendingRounds ?? 0), "Waiting for token sync"],
    ["Not found", formatNumber.format(summary.tokenNotFoundRounds ?? 0), "No matching log event yet"],
    ["Ambiguous", formatNumber.format(summary.tokenAmbiguousRounds ?? 0), "Needs manual binding"],
    ["Failed", formatNumber.format(summary.tokenFailedRounds ?? 0), "Sync script error"],
    ["Last token sync", formatDate(summary.lastTokenSyncedAt), "Most recent token update"],
    ["Last online sync", formatDate(summary.lastOnlineSyncedAt), "Most recent upload"],
    ["Log sources", `${formatNumber.format(summary.codexTokenRounds ?? 0)} / ${formatNumber.format(summary.claudeTokenRounds ?? 0)}`, "Codex / Claude"]
  ];

  $("#tokenQualityGrid").innerHTML = cards.map(([label, value, detail]) => `
    <article class="quality-card">
      <span>${escapeHtml(label)}</span>
      <strong>${escapeHtml(value)}</strong>
      <small>${escapeHtml(detail)}</small>
    </article>
  `).join("");
}

function renderKpis() {
  const summary = state.summary;
  if (!summary) return;
  const kpis = [
    ["有效需求", formatNumber.format(summary.requirementCount), `${summary.unlinkedRounds} 轮未关联需求`],
    ["有效轮次", formatNumber.format(summary.roundCount), `${summary.revertedRounds} 轮撤销记录`],
    ["总 Token", formatNumber.format(summary.totalTokens), `${summary.tokenMissingRounds} 轮缺 token`],
    ["代码改动", formatNumber.format(summary.codeLinesChanged), "新增 + 删除行"],
    ["行/千Token", formatMetric(summary.codeLinesPerKTokens), `Token/行 ${formatMetric(summary.tokensPerCodeLine)}`]
  ];

  $("#kpiGrid").innerHTML = kpis.map(([label, value, detail]) => `
    <article class="kpi">
      <span>${escapeHtml(label)}</span>
      <strong>${escapeHtml(value)}</strong>
      <small>${escapeHtml(detail)}</small>
    </article>
  `).join("");
}

function renderRequirementRecords() {
  $("#requirementRecordsTable").innerHTML = state.requirementRecords.map((row) => {
    const selected = state.editingRequirementId === row.requirementId ? "selected-row" : "";
    return `
      <tr class="${selected}" data-requirement-id="${row.requirementId}">
        <td>
          <button class="link-button" type="button" data-edit-requirement="${row.requirementId}">
            ${escapeHtml(row.requirementLabel)}
          </button>
          <span class="status-pill ${row.status === "archived" ? "reverted" : ""}">${escapeHtml(statusLabels[row.status] ?? row.status)}</span>
        </td>
        <td>${escapeHtml(row.projectName || "-")}</td>
        <td>${escapeHtml(row.gpmNumber || "-")}</td>
        <td class="number-cell">${formatNumber.format(row.roundCount)}</td>
        <td class="number-cell">${formatNumber.format(row.codeLinesChanged)}</td>
      </tr>
    `;
  }).join("") || emptyRow(5);
}

function renderRequirementChart() {
  const top = state.requirements.slice(0, 8);
  renderBarChart(
    $("#requirementChart"),
    top,
    (row) => row.requirementLabel,
    (row) => row.codeLinesPerKTokens ?? 0,
    (row) => `${formatMetric(row.codeLinesPerKTokens)} 行/千Token`
  );
}

function renderModelChart() {
  renderBarChart(
    $("#modelChart"),
    state.models,
    (row) => row.modelName,
    (row) => row.codeLinesPerKTokens ?? 0,
    (row) => `${formatMetric(row.codeLinesPerKTokens)} 行/千Token`
  );
}

function renderBarChart(container, rows, labelOf, valueOf, valueTextOf) {
  if (rows.length === 0) {
    container.innerHTML = `<div class="empty-state">暂无数据</div>`;
    return;
  }

  const max = Math.max(...rows.map(valueOf), 1);
  container.innerHTML = rows.map((row) => {
    const value = valueOf(row);
    const width = Math.max((value / max) * 100, value > 0 ? 4 : 0);
    return `
      <div class="bar-row">
        <div class="bar-label" title="${escapeHtml(labelOf(row))}">${escapeHtml(labelOf(row))}</div>
        <div class="bar-track"><div class="bar-fill" style="--width:${width}%"></div></div>
        <div class="bar-value">${escapeHtml(valueTextOf(row))}</div>
      </div>
    `;
  }).join("");
}

function renderTimeline() {
  const container = $("#timelineChart");
  if (state.timeline.length === 0) {
    container.innerHTML = `<div class="empty-state">暂无趋势数据</div>`;
    return;
  }

  const width = 920;
  const height = 240;
  const pad = 32;
  const maxCode = Math.max(...state.timeline.map((row) => row.codeLinesChanged), 1);
  const maxTokens = Math.max(...state.timeline.map((row) => row.totalTokens), 1);
  const points = (metric, max) => state.timeline.map((row, index) => {
    const x = pad + (index / Math.max(state.timeline.length - 1, 1)) * (width - pad * 2);
    const y = height - pad - (row[metric] / max) * (height - pad * 2);
    return `${x},${y}`;
  }).join(" ");

  const labels = state.timeline
    .filter((_, index) => index === 0 || index === state.timeline.length - 1)
    .map((row, index) => {
      const x = index === 0 ? pad : width - pad;
      return `<text class="axis-label" x="${x}" y="${height - 6}" text-anchor="${index === 0 ? "start" : "end"}">${escapeHtml(row.day.slice(5))}</text>`;
    }).join("");

  container.innerHTML = `
    <svg viewBox="0 0 ${width} ${height}" role="img" aria-label="每日趋势图">
      <polyline class="line-code" points="${points("codeLinesChanged", maxCode)}"></polyline>
      <polyline class="line-token" points="${points("totalTokens", maxTokens)}"></polyline>
      <text class="axis-label" x="${pad}" y="18">绿: 代码改动</text>
      <text class="axis-label" x="${pad + 120}" y="18">蓝: Token</text>
      ${labels}
    </svg>
  `;
}

function renderRequirementTable() {
  $("#requirementsTable").innerHTML = state.requirements.map((row) => `
    <tr>
      <td>
        <strong>${escapeHtml(row.requirementLabel)}</strong>
        <small class="muted-block">${escapeHtml([row.projectName, row.gpmNumber].filter(Boolean).join(" / ") || "-")}</small>
      </td>
      <td>${escapeHtml([row.projectName, row.gpmNumber].filter(Boolean).join(" / ") || "-")}</td>
      <td class="number-cell">${formatNumber.format(row.roundCount)}</td>
      <td class="number-cell">${formatDuration(row.durationMs)}</td>
      <td>${timeDrilldown(row.firstStartedAt, row.requirementId)}</td>
      <td>${timeDrilldown(row.lastEndedAt, row.requirementId)}</td>
      <td class="number-cell">${formatNumber.format(row.codeLinesChanged)}</td>
      <td class="number-cell">${formatNumber.format(row.totalTokens)}</td>
      <td class="number-cell">${formatMetric(row.codeLinesPerKTokens)}</td>
    </tr>
  `).join("") || emptyRow(9);
}

function renderRequirementTableDashboard() {
  $("#requirementsTable").innerHTML = state.requirements.map((row) => `
    <tr>
      <td>
        <strong>${escapeHtml(row.requirementLabel)}</strong>
        <small class="muted-block">${escapeHtml([row.projectName, row.gpmNumber].filter(Boolean).join(" / ") || "-")}</small>
      </td>
      <td>${escapeHtml([row.projectName, row.gpmNumber].filter(Boolean).join(" / ") || "-")}</td>
      <td class="number-cell">${formatNumber.format(row.roundCount)}</td>
      <td class="number-cell">${formatDuration(row.durationMs)}</td>
      <td>${timeDrilldown(row.firstStartedAt, row.requirementId)}</td>
      <td>${timeDrilldown(row.lastEndedAt, row.requirementId)}</td>
      <td class="number-cell">${formatNumber.format(row.codeLinesChanged)}</td>
      <td class="number-cell">${formatNumber.format(row.totalTokens)}</td>
      <td class="number-cell">${formatPercent(row.tokenCompletenessRate)}</td>
      <td class="number-cell">${formatNumber.format(row.tokenPendingRounds ?? 0)}</td>
      <td class="number-cell">${formatNumber.format(row.tokenIssueRounds ?? 0)}</td>
      <td class="number-cell">${formatMetric(row.codeLinesPerKTokens)}</td>
    </tr>
  `).join("") || emptyRow(12);
}

function renderModelTable() {
  $("#modelsTable").innerHTML = state.models.map((row) => `
    <tr>
      <td>${escapeHtml(row.modelName)}</td>
      <td class="number-cell">${formatNumber.format(row.effectiveRounds)}</td>
      <td class="number-cell">${formatNumber.format(row.codeLinesChanged)}</td>
      <td class="number-cell">${formatNumber.format(row.totalTokens)}</td>
      <td class="number-cell">${formatPercent(row.revertRate)}</td>
      <td class="number-cell">${formatDuration(row.averageDurationMs)}</td>
      <td class="number-cell">${formatMetric(row.codeLinesPerKTokens)}</td>
    </tr>
  `).join("") || emptyRow(7);
}

function renderRoundsTable() {
  $("#roundsTable").innerHTML = state.rounds.map((row) => `
    <tr>
      <td class="number-cell">${row.id}</td>
      <td>
        ${escapeHtml(row.requirementLabel)}
        <small class="muted-block">${escapeHtml([row.projectName, row.gpmNumber].filter(Boolean).join(" / ") || "-")}</small>
      </td>
      <td class="number-cell">${formatDate(row.startedAt)}</td>
      <td class="number-cell">${formatDate(row.endedAt)}</td>
      <td class="number-cell">${formatDuration(row.durationMs)}</td>
      <td>${escapeHtml(row.modelName)}</td>
      <td>${escapeHtml(row.client || "-")}</td>
      <td class="number-cell">${formatNumber.format(row.codeLinesChanged)}</td>
      <td class="number-cell">${formatNumber.format(row.totalTokens)}</td>
      <td><span class="status-pill ${row.isReverted ? "reverted" : ""}">${row.isReverted ? "已撤销" : "有效"}</span></td>
      <td class="prompt-cell" title="${escapeHtml(row.promptText)}">${escapeHtml(row.promptText || "-")}</td>
      <td>
        <button class="link-button" type="button" data-edit-round="${row.id}">编辑</button>
        <button class="link-button danger-link" type="button" data-delete-round="${row.id}">删除</button>
      </td>
    </tr>
  `).join("") || emptyRow(12);
}

function renderRoundsTableDashboard() {
  $("#roundsTable").innerHTML = state.rounds.map((row) => `
    <tr>
      <td class="number-cell">${row.id}</td>
      <td>
        ${escapeHtml(row.requirementLabel)}
        <small class="muted-block">${escapeHtml([row.projectName, row.gpmNumber].filter(Boolean).join(" / ") || "-")}</small>
      </td>
      <td class="number-cell">${formatDate(row.startedAt)}</td>
      <td class="number-cell">${formatDate(row.endedAt)}</td>
      <td class="number-cell">${formatDuration(row.durationMs)}</td>
      <td>${escapeHtml(row.modelName)}</td>
      <td>${escapeHtml(row.client || "-")}</td>
      <td class="number-cell">${formatNumber.format(row.codeLinesChanged)}</td>
      <td class="number-cell">${formatNumber.format(row.totalTokens)}</td>
      <td>${renderTokenStatus(row)}</td>
      <td>${escapeHtml(row.tokenMatchQuality || "-")}</td>
      <td><span class="status-pill ${row.isReverted ? "reverted" : ""}">${row.isReverted ? "宸叉挙閿€" : "鏈夋晥"}</span></td>
      <td class="prompt-cell" title="${escapeHtml(row.promptText)}">${escapeHtml(row.promptText || "-")}</td>
      <td>
        <button class="link-button" type="button" data-edit-round="${row.id}">缂栬緫</button>
        <button class="link-button danger-link" type="button" data-delete-round="${row.id}">鍒犻櫎</button>
      </td>
    </tr>
  `).join("") || emptyRow(14);
}

function renderTokenStatus(row) {
  const status = row.tokenSyncStatus || "-";
  const issue = status === "not_found" || status === "ambiguous" || status === "failed";
  const pending = status === "pending";
  const className = issue ? "reverted" : pending ? "pending" : "";
  const title = [row.tokenSyncNote, row.tokenSyncedAt ? `synced at ${formatDate(row.tokenSyncedAt)}` : ""]
    .filter(Boolean)
    .join(" / ");
  return `<span class="status-pill ${className}" title="${escapeHtml(title)}">${escapeHtml(status)}</span>`;
}

function timeDrilldown(value, requirementId) {
  if (!value) return "-";
  const params = collectFilterParams();
  if (requirementId === null) {
    params.set("requirementId", "null");
  } else {
    params.set("requirementId", String(requirementId));
  }
  return `<a class="time-link" href="/rounds.html?${params.toString()}">${escapeHtml(formatDate(value))}</a>`;
}

function renderLocalLogFiles() {
  const scan = state.localLogScan;
  $("#logScanStatus").textContent = scan
    ? `扫描 ${formatNumber.format(scan.scanned)} 个文件${scan.truncated ? "，已达到上限" : ""}`
    : "";
  $("#localLogFilesTable").innerHTML = state.localLogFiles.map((row) => `
    <tr class="${state.selectedLogFile === row.path ? "selected-row" : ""}">
      <td>
        <button class="link-button" type="button" data-log-path="${escapeHtml(row.path)}">${escapeHtml(row.name)}</button>
        <small class="muted-block path-cell">${escapeHtml(row.directory)}</small>
      </td>
      <td>${escapeHtml(row.kind)}</td>
      <td class="number-cell">${formatBytes(row.size)}</td>
      <td class="number-cell">${formatDate(row.mtime)}</td>
    </tr>
  `).join("") || emptyRow(4);
}

async function openLocalLog(filePath) {
  state.selectedLogFile = filePath;
  renderLocalLogFiles();
  $("#localLogPreview").textContent = "加载中...";
  const params = new URLSearchParams({
    path: filePath,
    tailBytes: $("#logTailBytesInput")?.value || "65536"
  });
  const payload = await api(`/api/local-logs/file?${params.toString()}`);
  $("#localLogPreviewMeta").textContent = payload.binary
    ? `${formatBytes(payload.size)} / SQLite 文件仅显示元信息`
    : `${formatBytes(payload.size)} / 读取尾部 ${formatBytes(payload.tailBytes)}${payload.truncated ? " / 已截断" : ""}`;
  $("#localLogPreview").textContent = payload.binary
    ? "这是 Codex SQLite 日志/状态库。为避免大文件和二进制内容拖慢页面，当前页面只展示文件元信息；token 同步仍由后端脚本读取它。"
    : payload.content || "文件尾部为空";
}

function editRound(roundId) {
  const record = state.rounds.find((row) => row.id === roundId);
  if (!record) return;

  state.editingRoundId = roundId;
  $("#roundIdInput").value = String(record.id);
  $("#roundRequirementInput").value = record.requirementId === null ? "" : String(record.requirementId);
  $("#roundModelInput").value = record.modelName || "";
  $("#roundStartedInput").value = toDateTimeLocal(record.startedAt);
  $("#roundEndedInput").value = toDateTimeLocal(record.endedAt);
  $("#roundClientInput").value = record.client || "";
  $("#roundFilesInput").value = record.filesChanged === null ? "" : String(record.filesChanged);
  $("#roundLinesAddedInput").value = String(record.linesAdded ?? 0);
  $("#roundLinesDeletedInput").value = String(record.linesDeleted ?? 0);
  $("#roundCodeLinesInput").value = String(record.codeLinesChanged ?? 0);
  $("#roundInputTokensInput").value = String(record.inputTokens ?? 0);
  $("#roundOutputTokensInput").value = String(record.outputTokens ?? 0);
  $("#roundTotalTokensInput").value = String(record.totalTokens ?? 0);
  $("#roundPromptInput").value = record.promptText || "";
  setRoundMessage("");
}

function resetRoundForm() {
  state.editingRoundId = null;
  $("#roundForm")?.reset();
  $("#roundIdInput").value = "";
  setRoundMessage("选择表格中的对话后可编辑");
}

async function saveRound(event) {
  event.preventDefault();
  const roundId = Number($("#roundIdInput").value);
  if (!Number.isSafeInteger(roundId) || roundId <= 0) {
    setRoundMessage("请先选择一条对话", true);
    return;
  }

  setRoundMessage("保存中...");
  await api(`/api/rounds/${roundId}`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      requirementId: $("#roundRequirementInput").value,
      modelName: $("#roundModelInput").value,
      startedAt: fromDateTimeLocal($("#roundStartedInput").value),
      endedAt: fromDateTimeLocal($("#roundEndedInput").value),
      client: $("#roundClientInput").value,
      filesChanged: $("#roundFilesInput").value,
      linesAdded: $("#roundLinesAddedInput").value,
      linesDeleted: $("#roundLinesDeletedInput").value,
      codeLinesChanged: $("#roundCodeLinesInput").value,
      inputTokens: $("#roundInputTokensInput").value,
      outputTokens: $("#roundOutputTokensInput").value,
      totalTokens: $("#roundTotalTokensInput").value,
      promptText: $("#roundPromptInput").value
    })
  });

  await loadFilters();
  await loadPageData();
  renderFilters();
  setRoundMessage("已保存");
}

async function deleteRound(roundId = state.editingRoundId) {
  if (!roundId) {
    setRoundMessage("请先选择一条对话", true);
    return;
  }
  const confirmed = window.confirm(`确认删除对话 #${roundId}？这会影响统计结果。`);
  if (!confirmed) return;

  setRoundMessage("删除中...");
  await api(`/api/rounds/${roundId}`, { method: "DELETE" });
  resetRoundForm();
  await loadFilters();
  await loadPageData();
  renderFilters();
  setRoundMessage("已删除");
}

function setRoundMessage(message, isError = false) {
  const element = $("#roundFormMessage");
  if (!element) return;
  element.textContent = message;
  element.classList.toggle("form-error", isError);
}

function editRequirement(requirementId) {
  const record = state.requirementRecords.find((row) => row.requirementId === requirementId);
  if (!record) return;

  state.editingRequirementId = requirementId;
  $("#requirementIdInput").value = String(record.requirementId);
  $("#requirementStatusInput").value = record.status || "active";
  $("#requirementTitleInput").value = record.title || "";
  $("#requirementProjectInput").value = record.projectName || "";
  $("#requirementGpmInput").value = record.gpmNumber || "";
  $("#requirementDescriptionInput").value = record.description || "";
  setRequirementMessage("");
  renderRequirementRecords();
}

function resetRequirementForm() {
  state.editingRequirementId = null;
  $("#requirementForm").reset();
  $("#requirementStatusInput").value = "active";
  setRequirementMessage("");
  renderRequirementRecords();
}

async function saveRequirement(event) {
  event.preventDefault();
  const requirementId = Number($("#requirementIdInput").value);
  if (!Number.isSafeInteger(requirementId) || requirementId <= 0) {
    setRequirementMessage("需求编号必须是正整数", true);
    return;
  }

  setRequirementMessage("保存中...");
  await api(`/api/requirement-records/${requirementId}`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      title: $("#requirementTitleInput").value,
      projectName: $("#requirementProjectInput").value,
      gpmNumber: $("#requirementGpmInput").value,
      status: $("#requirementStatusInput").value,
      description: $("#requirementDescriptionInput").value
    })
  });

  state.editingRequirementId = requirementId;
  await loadFilters();
  await loadPageData();
  renderFilters();
  setRequirementMessage("已保存");
}

async function deleteRequirement() {
  const requirementId = Number($("#requirementIdInput").value);
  if (!Number.isSafeInteger(requirementId) || requirementId <= 0) {
    setRequirementMessage("请先选择或输入需求编号", true);
    return;
  }
  const confirmed = window.confirm(`确认删除需求 #${requirementId} 的维护信息？历史对话记录不会删除。`);
  if (!confirmed) return;

  setRequirementMessage("删除中...");
  await api(`/api/requirement-records/${requirementId}`, { method: "DELETE" });
  resetRequirementForm();
  await loadFilters();
  await loadPageData();
  renderFilters();
  setRequirementMessage("已删除");
}

function setRequirementMessage(message, isError = false) {
  const element = $("#requirementFormMessage");
  if (!element) return;
  element.textContent = message;
  element.classList.toggle("form-error", isError);
}

function emptyRow(columns) {
  return `<tr><td colspan="${columns}" class="empty-state">暂无数据</td></tr>`;
}

function formatMetric(value) {
  return value === null || value === undefined ? "-" : formatDecimal.format(value);
}

function formatPercent(value) {
  return `${formatDecimal.format((value ?? 0) * 100)}%`;
}

function formatDuration(ms) {
  const seconds = Math.round((ms ?? 0) / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  return `${formatDecimal.format(minutes / 60)}h`;
}

function formatDate(value) {
  if (!value) return "-";
  return formatDateTime.format(new Date(value));
}

function formatBytes(value) {
  const bytes = Number(value ?? 0);
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${formatDecimal.format(bytes / 1024)} KB`;
  return `${formatDecimal.format(bytes / 1024 / 1024)} MB`;
}

function toDateTimeLocal(value) {
  if (!value) return "";
  const date = new Date(value);
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 19);
}

function fromDateTimeLocal(value) {
  return value ? new Date(value).toISOString() : "";
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function bindRequirementMaintenance() {
  if (!$("#requirementForm")) return;
  $("#newRequirementButton").addEventListener("click", resetRequirementForm);
  $("#resetRequirementButton").addEventListener("click", resetRequirementForm);
  $("#deleteRequirementButton").addEventListener("click", () => {
    void deleteRequirement().catch((error) => {
      setRequirementMessage(error instanceof Error ? error.message : "删除失败", true);
    });
  });
  $("#requirementForm").addEventListener("submit", (event) => {
    void saveRequirement(event).catch((error) => {
      setRequirementMessage(error instanceof Error ? error.message : "保存失败", true);
    });
  });
  $("#requirementRecordsTable").addEventListener("click", (event) => {
    const button = event.target.closest("[data-edit-requirement]");
    if (!button) return;
    editRequirement(Number(button.dataset.editRequirement));
  });
  resetRequirementForm();
}

function bindRoundEditor() {
  if (!$("#roundForm")) return;
  $("#clearRoundEditorButton").addEventListener("click", resetRoundForm);
  $("#deleteRoundButton").addEventListener("click", () => {
    void deleteRound().catch((error) => {
      setRoundMessage(error instanceof Error ? error.message : "删除失败", true);
    });
  });
  $("#roundForm").addEventListener("submit", (event) => {
    void saveRound(event).catch((error) => {
      setRoundMessage(error instanceof Error ? error.message : "保存失败", true);
    });
  });
  $("#roundsTable").addEventListener("click", (event) => {
    const editButton = event.target.closest("[data-edit-round]");
    if (editButton) {
      editRound(Number(editButton.dataset.editRound));
      return;
    }

    const deleteButton = event.target.closest("[data-delete-round]");
    if (deleteButton) {
      void deleteRound(Number(deleteButton.dataset.deleteRound)).catch((error) => {
        setRoundMessage(error instanceof Error ? error.message : "删除失败", true);
      });
    }
  });
  resetRoundForm();
}

function bindLocalLogs() {
  if (!$("#localLogFilesTable")) return;
  $("#loadLogsButton").addEventListener("click", () => {
    void loadLocalLogFiles().then(renderLocalLogFiles).catch((error) => {
      $("#logScanStatus").textContent = error instanceof Error ? error.message : "加载失败";
    });
  });
  $("#localLogFilesTable").addEventListener("click", (event) => {
    const button = event.target.closest("[data-log-path]");
    if (!button) return;
    void openLocalLog(button.dataset.logPath).catch((error) => {
      $("#localLogPreview").textContent = error instanceof Error ? error.message : "读取失败";
    });
  });
}

$("#logoutButton").addEventListener("click", async () => {
  await fetch("/api/logout", { method: "POST" });
  location.href = "/login";
});

renderNav();
await loadFilters();
renderFilters();
bindRequirementMaintenance();
bindRoundEditor();
bindLocalLogs();
await loadPageData();
