export const workSnapshot = {
  tasks: [
    {
      id: "reply-roadmap",
      title: "确认 Q3 产品路线并回复项目组",
      meta: "Outlook · 今天 11:30 前",
      priority: "P0",
      completed: false,
    },
    {
      id: "prepare-weekly",
      title: "整理周例会的风险与决策项",
      meta: "钉钉会议 · 10:30 前",
      priority: "P0",
      completed: false,
    },
    {
      id: "review-proposal",
      title: "复核供应商报价与审批建议",
      meta: "Outlook · 今天 15:00",
      priority: "P1",
      completed: false,
    },
    {
      id: "weekly-input",
      title: "补充本周成果与阻塞项",
      meta: "周报 · 周五前",
      priority: "P1",
      completed: true,
    },
  ],
  focus: [
    {
      title: "把输入转成明确行动",
      detail: "邮件、会议纪要和临时想法都要在当天归入待办或明确归档。",
      tag: "工作流",
    },
    {
      title: "守住本周交付节奏",
      detail: "优先处理路线确认与报价审批，避免重要决策被零碎沟通打断。",
      tag: "交付",
    },
    {
      title: "记录可复用的决策依据",
      detail: "把关键结论、风险和待验证假设沉淀到知识库，方便周报复盘。",
      tag: "复盘",
    },
  ],
  meetings: [
    { time: "10:30", duration: "45 分钟", title: "产品路线周例会", people: "产品、研发、设计", type: "周例会" },
    { time: "14:00", duration: "30 分钟", title: "供应商报价评审", people: "采购、财务", type: "评审" },
    { time: "16:30", duration: "25 分钟", title: "项目风险同步", people: "项目组", type: "同步" },
  ],
  emails: [
    { sender: "项目组", subject: "请确认 Q3 产品路线图", action: "需要回复", deadline: "11:30", priority: "高" },
    { sender: "采购支持", subject: "供应商报价审批请求", action: "需要审批", deadline: "15:00", priority: "高" },
    { sender: "合作伙伴", subject: "下周演示可用时间", action: "需要确认", deadline: "今天", priority: "中" },
  ],
  report: {
    period: "2026-08-10 至 2026-08-14",
    highlights: ["完成产品路线的关键决策对齐", "推进供应商报价审批", "整理项目风险并形成后续行动"],
    blockers: ["等待跨团队确认接口排期", "报价审批依赖预算口径复核"],
  },
};

export function buildWeeklyReport(outlookItems = [], taskItems = workSnapshot.tasks, dailyReports = [], aiSummary = null, weeklyFocus = []) {
  const { report } = workSnapshot;
  const tasks = Array.isArray(taskItems) ? taskItems : workSnapshot.tasks;
  const done = tasks.filter((task) => task.completed || task.status === "completed").length;
  const mailSection = outlookItems.length ? `\n## 待办邮件\n${outlookItems.map((item) => `- ${item.subject}：${item.summary}`).join("\n")}\n` : "";
  const summary = aiSummary?.summary || `本周围绕产品路线确认与关键协作推进。已完成 ${done} 项既定行动；下周优先完成跨团队排期确认与报价审批闭环。`;
  const highlights = aiSummary?.highlights?.length ? aiSummary.highlights : report.highlights;
  const blockers = aiSummary?.blockers?.length ? aiSummary.blockers : report.blockers;
  const nextActions = aiSummary?.nextActions?.length
    ? aiSummary.nextActions.map((item) => `- [ ] ${item}`).join("\n")
    : tasks.filter((task) => !(task.completed || task.status === "completed")).map((task) => `- [ ] ${task.title}`).join("\n");
  const dailySection = dailyReports.length
    ? `\n## 成员日报\n${dailyReports.map((item) => `### ${item.reportDate}\n${item.summary || "无总结"}\n\n已完成：${item.completedItems || "无"}\n阻塞与风险：${item.blockers || "无"}\n下一步：${item.nextActions || "无"}`).join("\n\n")}\n`
    : "";
  const focusSection = weeklyFocus.length
    ? `\n## 本周关注\n${weeklyFocus.map((item) => `### ${item.title}\n进度：${item.progress}% · 状态：${item.status === "completed" ? "已完成" : "进行中"}\n${item.detail || ""}\n下一步：${item.nextStep || "未填写"}`).join("\n\n")}\n`
    : "";
  return `# 本周工作周报\n\n周期：${report.period}\n\n## AI 摘要${aiSummary ? "" : "（本地示例）"}\n${summary}\n\n## 关键进展\n${highlights.map((item) => `- ${item}`).join("\n")}\n\n## 风险与阻塞\n${blockers.map((item) => `- ${item}`).join("\n")}\n${focusSection}${mailSection}${dailySection}\n## 下周行动\n${nextActions}\n`;
}
