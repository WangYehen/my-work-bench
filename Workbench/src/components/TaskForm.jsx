import { useEffect, useState } from "react";
import { IconCheck, IconChevronDown, IconX } from "@tabler/icons-react";
import { DateTimePicker } from "./WorkbenchCalendar";

export const emptyTaskForm = { title: "", detail: "", priority: "P1", dueAt: "" };

// 优先级下拉选择器
export function PrioritySelect({ value, onChange }) {
  const [open, setOpen] = useState(false);
  const options = [["P0", "最高优先"], ["P1", "重要"], ["P2", "普通"]];
  const current = options.find(([key]) => key === value) || options[1];
  return <div className={`task-priority-picker${open ? " is-open" : ""}`}>
    <button aria-expanded={open} aria-haspopup="listbox" className="task-priority-picker__trigger" onClick={() => setOpen((state) => !state)} type="button">
      <span className={`task-priority-picker__dot task-priority-picker__dot--${current[0].toLowerCase()}`} />
      <span><b>{current[0]}</b><small>{current[1]}</small></span><IconChevronDown size={14} />
    </button>
    {open && <div className="task-priority-picker__menu" role="listbox">{options.map(([key, label]) => <button aria-selected={key === value} className={key === value ? "is-selected" : ""} key={key} onClick={() => { onChange(key); setOpen(false); }} role="option" type="button"><span className={`task-priority-picker__dot task-priority-picker__dot--${key.toLowerCase()}`} /><span><b>{key}</b><small>{label}</small></span>{key === value && <IconCheck size={14} />}</button>)}</div>}
  </div>;
}

// 任务创建/编辑表单
export function TaskForm({ initial = emptyTaskForm, onSubmit, onCancel, busy }) {
  const [form, setForm] = useState(initial);
  const set = (key, value) => setForm((current) => ({ ...current, [key]: value }));
  return <form className="task-form" onSubmit={(event) => { event.preventDefault(); onSubmit(form); }}>
    <input className="task-form__title" autoFocus={!initial.id} required maxLength={200} placeholder="例如：确认 Q3 产品路线" value={form.title} onChange={(event) => set("title", event.target.value)} />
    <input placeholder="备注（可选）" maxLength={1000} value={form.detail || ""} onChange={(event) => set("detail", event.target.value)} />
    <PrioritySelect value={form.priority} onChange={(value) => set("priority", value)} />
    <label className="task-form__due"><span>截止时间</span><DateTimePicker value={form.dueAt || ""} onChange={(value) => set("dueAt", value)} /></label>
    <div className="task-form__actions"><button className="work-button work-button--primary" disabled={busy} type="submit"><IconCheck size={15} />{initial.id ? "保存" : "添加任务"}</button>{onCancel && <button className="work-button" type="button" onClick={onCancel}>取消</button>}</div>
  </form>;
}

// 任务新增/编辑对话框
export function TaskDialog({ initial, onSubmit, onClose, busy }) {
  useEffect(() => {
    const handleKeyDown = (event) => {
      if (event.key === "Escape" && !busy) onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [busy, onClose]);

  return <div className="task-modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) onClose(); }}>
    <section aria-labelledby="task-dialog-title" aria-modal="true" className="task-modal" role="dialog">
      <header className="task-modal__header">
        <div><span className="eyebrow">WORK / TASK</span><h2 id="task-dialog-title">{initial?.id ? "编辑任务" : "新增任务"}</h2><p>记录今天需要推进的一件具体行动，可设置优先级与截止时间。</p></div>
        <button aria-label="关闭弹窗" className="task-modal__close" disabled={busy} onClick={onClose} type="button"><IconX size={19} /></button>
      </header>
      <TaskForm initial={initial || emptyTaskForm} busy={busy} onSubmit={onSubmit} onCancel={onClose} />
    </section>
  </div>;
}
