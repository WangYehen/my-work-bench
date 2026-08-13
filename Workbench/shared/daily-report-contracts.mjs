export const DAILY_REPORT_STATUSES = ["draft", "pending_sync", "synced", "error"];

export function normalizeDailyReportInput(input = {}) {
  const report = {
    reportDate: String(input.reportDate || "").trim(),
    summary: String(input.summary || "").trim(),
    completedItems: String(input.completedItems || "").trim(),
    blockers: String(input.blockers || "").trim(),
    nextActions: String(input.nextActions || "").trim(),
  };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(report.reportDate)) {
    const error = new Error("日报日期必须使用 YYYY-MM-DD 格式。");
    error.code = "INVALID_REPORT_DATE";
    throw error;
  }
  if (!report.summary) {
    const error = new Error("日报摘要不能为空。");
    error.code = "REPORT_SUMMARY_REQUIRED";
    throw error;
  }
  for (const [key, value] of Object.entries(report)) {
    if (value.length > 10_000) {
      const error = new Error(`${key} 超过长度限制。`);
      error.code = "REPORT_FIELD_TOO_LONG";
      throw error;
    }
  }
  return report;
}

