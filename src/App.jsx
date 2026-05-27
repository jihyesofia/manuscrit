import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import {
  FolderOpen, FileText, Trash2, ChevronRight, ChevronDown,
  Cloud, CloudOff, BookOpen, StickyNote, Menu, X,
  Loader2, LogOut, FolderPlus, FilePlus, MoreVertical,
  Download, FileDown, Square, CheckSquare, GripVertical,
  Search
} from "lucide-react";

/* ═══════════════════ Constants ═══════════════════ */

const GOOGLE_CLIENT_ID = "350404763677-306fu0u0qksg4vqa42p77igl3f2t0m22.apps.googleusercontent.com";
const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive.appdata";
const DRIVE_FILE_NAME = "manuscrit_project_data.json";
const AUTOSAVE_DELAY = 3000;
const LS_KEY = "manuscrit_data";
const LONG_PRESS_MS = 500;
const createId = () => Math.random().toString(36).slice(2, 10);

const STATUS_CONFIG = {
  draft:    { label: "초고", color: "#e89830" },
  revision: { label: "퇴고", color: "#d45555" },
  complete: { label: "완성", color: "#4abe6a" },
};
const STATUS_ORDER = ["draft", "revision", "complete"];
const nextStatus = (s) => STATUS_ORDER[(STATUS_ORDER.indexOf(s) + 1) % STATUS_ORDER.length];

/* ═══════════════════ Default Data ═══════════════════ */

const defaultProjects = [
  {
    id: createId(), title: "남자 사이에 우정은 없어", expanded: true,
    children: [
      { id: createId(), type: "synopsis", title: "시놉시스", content: "두 남자의 우정과 사랑 사이, 그 경계에서 흔들리는 이야기.\n\n\"우리 사이에 우정이라는 건 처음부터 없었을지도 몰라.\"", memo: "핵심 테마: 우정의 변질, 감정의 경계\n장르: BL, 현대 로맨스" },
      { id: createId(), type: "chapter", title: "제1화: 재회", content: "", memo: "도입부 — 5년 만의 재회 장면으로 시작\n분위기: 비 오는 서울, 을지로 골목", status: "revision" },
      { id: createId(), type: "chapter", title: "제2화: 균열", content: "", memo: "", status: "draft" },
    ],
  },
  {
    id: createId(), title: "프래질 프랙탈", expanded: false,
    children: [
      { id: createId(), type: "synopsis", title: "시놉시스", content: "부서지기 쉬운 것들이 만들어내는 무한한 패턴에 관하여.", memo: "SF + 문학 융합\n프랙탈 구조를 서사에 반영" },
      { id: createId(), type: "chapter", title: "제1화: 반복", content: "", memo: "", status: "draft" },
    ],
  },
  {
    id: createId(), title: "오프 밸런스", expanded: false,
    children: [
      { id: createId(), type: "synopsis", title: "시놉시스", content: "균형을 잃은 두 사람이 서로에게 기대어 서는 법을 배우는 이야기.", memo: "기업 로맨스\nM&A 소재" },
      { id: createId(), type: "chapter", title: "제1화: 인수", content: "", memo: "", status: "complete" },
      { id: createId(), type: "chapter", title: "제2화: 실사", content: "", memo: "", status: "revision" },
      { id: createId(), type: "chapter", title: "제3화: 합병", content: "", memo: "", status: "draft" },
    ],
  },
];

/* ═══════════════════ Google Drive API ═══════════════════ */

const driveApi = {
  tokenClient: null, accessToken: null,
  async init() {
    return new Promise((resolve) => {
      if (typeof window === "undefined" || !window.google?.accounts) { resolve(false); return; }
      try {
        this.tokenClient = window.google.accounts.oauth2.initTokenClient({ client_id: GOOGLE_CLIENT_ID, scope: DRIVE_SCOPE, callback: () => {} });
        resolve(true);
      } catch { resolve(false); }
    });
  },
  requestToken() {
    return new Promise((resolve, reject) => {
      if (!this.tokenClient) { reject(new Error("Not initialized")); return; }
      this.tokenClient.callback = (r) => { if (r.error) reject(r); else { this.accessToken = r.access_token; resolve(r.access_token); } };
      this.tokenClient.requestAccessToken({ prompt: "consent" });
    });
  },
  async findFile() {
    const r = await fetch(`https://www.googleapis.com/drive/v3/files?spaces=appDataFolder&q=name='${DRIVE_FILE_NAME}'&fields=files(id,name,modifiedTime)`, { headers: { Authorization: `Bearer ${this.accessToken}` } });
    const d = await r.json(); return d.files?.[0] || null;
  },
  async readFile(id) {
    const r = await fetch(`https://www.googleapis.com/drive/v3/files/${id}?alt=media`, { headers: { Authorization: `Bearer ${this.accessToken}` } });
    return r.json();
  },
  async saveFile(content, existingId) {
    const meta = { name: DRIVE_FILE_NAME, mimeType: "application/json" };
    if (!existingId) meta.parents = ["appDataFolder"];
    const form = new FormData();
    form.append("metadata", new Blob([JSON.stringify(meta)], { type: "application/json" }));
    form.append("file", new Blob([JSON.stringify(content)], { type: "application/json" }));
    const url = existingId ? `https://www.googleapis.com/upload/drive/v3/files/${existingId}?uploadType=multipart` : "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart";
    const r = await fetch(url, { method: existingId ? "PATCH" : "POST", headers: { Authorization: `Bearer ${this.accessToken}` }, body: form });
    return r.json();
  },
};

/* ═══════════════════ Hooks ═══════════════════ */

function useMediaQuery(query) {
  const [m, setM] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined") return;
    const mql = window.matchMedia(query); setM(mql.matches);
    const h = (e) => setM(e.matches); mql.addEventListener("change", h);
    return () => mql.removeEventListener("change", h);
  }, [query]);
  return m;
}

function useDebounce(cb, delay) {
  const t = useRef(null);
  const fn = useCallback((...a) => { if (t.current) clearTimeout(t.current); t.current = setTimeout(() => cb(...a), delay); }, [cb, delay]);
  useEffect(() => () => { if (t.current) clearTimeout(t.current); }, []);
  return fn;
}

function useLongPress(onLongPress, onClick, delay = LONG_PRESS_MS) {
  const timerRef = useRef(null);
  const didLP = useRef(false);
  const startPos = useRef({ x: 0, y: 0 });

  const start = useCallback((e) => {
    didLP.current = false;
    const t = e.touches?.[0] || e;
    startPos.current = { x: t.clientX, y: t.clientY };
    timerRef.current = setTimeout(() => { didLP.current = true; onLongPress(e); }, delay);
  }, [onLongPress, delay]);

  const move = useCallback((e) => {
    if (!timerRef.current) return;
    const t = e.touches?.[0] || e;
    if (Math.abs(t.clientX - startPos.current.x) > 10 || Math.abs(t.clientY - startPos.current.y) > 10) {
      clearTimeout(timerRef.current); timerRef.current = null;
    }
  }, []);

  const end = useCallback((e) => {
    if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null; }
    if (!didLP.current && onClick) onClick(e);
  }, [onClick]);

  const cancel = useCallback(() => { if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null; } }, []);

  return useMemo(() => ({
    onMouseDown: start, onMouseMove: move, onMouseUp: end, onMouseLeave: cancel,
    onTouchStart: start, onTouchMove: move, onTouchEnd: end, onTouchCancel: cancel,
  }), [start, move, end, cancel]);
}

/* ═══════════════════ Sub-Components ═══════════════════ */

function ProjectItem({ project, index, activeDocId, editingTitleId, editingTitleValue, setEditingTitleValue, contextMenuId, dragItem, dropIndicator, onToggle, onStartRename, onCommitRename, onCancelRename, onAddChapter, onDeleteProject, onSetContextMenu, onDragStartProject, onDragOverProject, onDragStartDoc, onDragOverDoc, onDrop, onDragEnd, onSelectDoc, isDesktop, onCloseLeft, onDeleteDoc, onCycleStatus }) {
  const lp = useLongPress(
    useCallback(() => onStartRename(project.id, project.title), [project.id, project.title, onStartRename]),
    useCallback(() => onToggle(project.id), [project.id, onToggle]),
  );

  return (
    <div className="mb-1" onDrop={onDrop} onDragEnd={onDragEnd}>
      {dropIndicator?.id === project.id && dropIndicator.position === "above" && (
        <div style={{ height: 2, background: "var(--accent)", margin: "0 8px", borderRadius: 1 }} />
      )}
      <div
        className="flex items-center gap-1 px-2 py-2 mx-2 rounded-md cursor-grab group"
        draggable onDragStart={(e) => onDragStartProject(e, project.id, index)}
        onDragOver={(e) => onDragOverProject(e, project.id, index)}
        style={{ transition: "background 150ms", opacity: dragItem?.id === project.id ? 0.4 : 1 }}
        onMouseEnter={(e) => { if (!dragItem) e.currentTarget.style.background = "var(--hover-bg)"; }}
        onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
      >
        <div className="flex-shrink-0 cursor-grab opacity-0 group-hover:opacity-40" style={{ color: "var(--text-muted)" }}><GripVertical size={12} /></div>
        <button onClick={() => onToggle(project.id)} className="flex-shrink-0" style={{ color: "var(--text-muted)" }}>
          {project.expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        </button>
        <FolderOpen size={14} style={{ color: "var(--accent)", flexShrink: 0 }} />
        {editingTitleId === project.id ? (
          <input autoFocus value={editingTitleValue}
            onChange={(e) => setEditingTitleValue(e.target.value)}
            onBlur={() => onCommitRename(project.id)}
            onKeyDown={(e) => { if (e.key === "Enter") onCommitRename(project.id); if (e.key === "Escape") onCancelRename(); }}
            className="flex-1 text-xs px-1 py-0.5 rounded outline-none"
            style={{ background: "var(--input-bg)", color: "var(--text-primary)", border: "1px solid var(--border-subtle)", fontFamily: "'Nanum Gothic', sans-serif" }}
            onClick={(e) => e.stopPropagation()} />
        ) : (
          <span className="flex-1 text-xs font-bold truncate select-none" style={{ color: "var(--text-primary)" }} {...lp}>{project.title}</span>
        )}
        <div className="relative flex-shrink-0">
          <button className="opacity-0 group-hover:opacity-100 p-0.5 rounded" style={{ color: "var(--text-muted)", transition: "opacity 150ms" }}
            onClick={(e) => { e.stopPropagation(); onSetContextMenu(contextMenuId === project.id ? null : project.id); }}>
            <MoreVertical size={13} />
          </button>
          {contextMenuId === project.id && (
            <div className="absolute right-0 top-6 z-50 rounded-lg shadow-lg py-1 min-w-[140px]" style={{ background: "var(--surface-elevated)", border: "1px solid var(--border-subtle)" }} onClick={(e) => e.stopPropagation()}>
              <button className="flex items-center gap-2 w-full px-3 py-1.5 text-xs text-left" style={{ color: "var(--text-secondary)" }}
                onMouseEnter={(e) => e.currentTarget.style.background = "var(--hover-bg)"} onMouseLeave={(e) => e.currentTarget.style.background = "transparent"}
                onClick={() => { onAddChapter(project.id); onSetContextMenu(null); }}><FilePlus size={12} /> 화 추가</button>
              <button className="flex items-center gap-2 w-full px-3 py-1.5 text-xs text-left" style={{ color: "var(--text-secondary)" }}
                onMouseEnter={(e) => e.currentTarget.style.background = "var(--hover-bg)"} onMouseLeave={(e) => e.currentTarget.style.background = "transparent"}
                onClick={() => { onStartRename(project.id, project.title); onSetContextMenu(null); }}><FileText size={12} /> 이름 변경</button>
              <div className="my-1" style={{ borderTop: "1px solid var(--border-subtle)" }} />
              <button className="flex items-center gap-2 w-full px-3 py-1.5 text-xs text-left" style={{ color: "#e55" }}
                onMouseEnter={(e) => e.currentTarget.style.background = "var(--hover-bg)"} onMouseLeave={(e) => e.currentTarget.style.background = "transparent"}
                onClick={() => { if (confirm(`"${project.title}" 프로젝트를 삭제하시겠습니까?`)) onDeleteProject(project.id); }}><Trash2 size={12} /> 프로젝트 삭제</button>
            </div>
          )}
        </div>
      </div>
      {dropIndicator?.id === project.id && dropIndicator.position === "below" && (
        <div style={{ height: 2, background: "var(--accent)", margin: "0 8px", borderRadius: 1 }} />
      )}
      {project.expanded && (
        <div className="ml-5">
          {project.children.map((child, ci) => (
            <DocItem key={child.id} child={child} projectId={project.id} index={ci}
              activeDocId={activeDocId} editingTitleId={editingTitleId} editingTitleValue={editingTitleValue}
              setEditingTitleValue={setEditingTitleValue} dragItem={dragItem} dropIndicator={dropIndicator}
              onStartRename={onStartRename} onCommitRename={onCommitRename} onCancelRename={onCancelRename}
              onSelectDoc={onSelectDoc} isDesktop={isDesktop} onCloseLeft={onCloseLeft}
              onDragStartDoc={onDragStartDoc} onDragOverDoc={onDragOverDoc} onDrop={onDrop} onDragEnd={onDragEnd}
              onDeleteDoc={onDeleteDoc} onCycleStatus={onCycleStatus} />
          ))}
        </div>
      )}
    </div>
  );
}

function DocItem({ child, projectId, index, activeDocId, editingTitleId, editingTitleValue, setEditingTitleValue, dragItem, dropIndicator, onStartRename, onCommitRename, onCancelRename, onSelectDoc, isDesktop, onCloseLeft, onDragStartDoc, onDragOverDoc, onDrop, onDragEnd, onDeleteDoc, onCycleStatus }) {
  const lp = useLongPress(
    useCallback(() => onStartRename(child.id, child.title), [child.id, child.title, onStartRename]),
    useCallback(() => { onSelectDoc(child.id); if (!isDesktop) onCloseLeft(); }, [child.id, onSelectDoc, isDesktop, onCloseLeft]),
  );
  const st = STATUS_CONFIG[child.status] || STATUS_CONFIG.draft;

  return (
    <>
      {dropIndicator?.id === child.id && dropIndicator.position === "above" && (
        <div style={{ height: 2, background: "var(--accent)", margin: "0 8px", borderRadius: 1 }} />
      )}
      <div
        className="flex items-center gap-1.5 px-2 py-1.5 mx-2 rounded-md cursor-grab group"
        draggable onDragStart={(e) => onDragStartDoc(e, child.id, projectId, index)}
        onDragOver={(e) => onDragOverDoc(e, child.id, projectId, index)}
        onDrop={onDrop} onDragEnd={onDragEnd}
        style={{ background: activeDocId === child.id ? "var(--active-bg)" : "transparent", transition: "background 150ms", opacity: dragItem?.id === child.id ? 0.4 : 1 }}
        onMouseEnter={(e) => { if (activeDocId !== child.id && !dragItem) e.currentTarget.style.background = "var(--hover-bg)"; }}
        onMouseLeave={(e) => { if (activeDocId !== child.id) e.currentTarget.style.background = "transparent"; }}
      >
        <div className="flex-shrink-0 cursor-grab opacity-0 group-hover:opacity-40" style={{ color: "var(--text-muted)" }}><GripVertical size={10} /></div>
        {child.type === "synopsis" ? <StickyNote size={12} style={{ color: "var(--accent-warm)", flexShrink: 0 }} /> : <FileText size={12} style={{ color: "var(--text-muted)", flexShrink: 0 }} />}
        {editingTitleId === child.id ? (
          <input autoFocus value={editingTitleValue}
            onChange={(e) => setEditingTitleValue(e.target.value)}
            onBlur={() => onCommitRename(child.id)}
            onKeyDown={(e) => { if (e.key === "Enter") onCommitRename(child.id); if (e.key === "Escape") onCancelRename(); }}
            className="flex-1 text-xs px-1 py-0.5 rounded outline-none"
            style={{ background: "var(--input-bg)", color: "var(--text-primary)", border: "1px solid var(--border-subtle)", fontFamily: "'Nanum Gothic', sans-serif" }}
            onClick={(e) => e.stopPropagation()} />
        ) : (
          <span className="flex-1 text-xs truncate select-none"
            style={{ color: activeDocId === child.id ? "var(--text-primary)" : "var(--text-secondary)", fontWeight: activeDocId === child.id ? 700 : 400 }}
            {...lp}>{child.title}</span>
        )}
        {/* Status dot — click to cycle */}
        {child.type === "chapter" && (
          <button
            onClick={(e) => { e.stopPropagation(); onCycleStatus(child.id); }}
            title={st.label}
            className="flex-shrink-0 p-0.5 rounded-full"
            style={{ transition: "transform 150ms" }}
            onMouseEnter={(e) => e.currentTarget.style.transform = "scale(1.3)"}
            onMouseLeave={(e) => e.currentTarget.style.transform = "scale(1)"}
          >
            <div style={{ width: 7, height: 7, borderRadius: "50%", background: st.color }} />
          </button>
        )}
        <button className="opacity-0 group-hover:opacity-100 p-0.5 rounded flex-shrink-0" style={{ color: "var(--text-muted)", transition: "opacity 150ms" }}
          onClick={(e) => { e.stopPropagation(); if (confirm(`"${child.title}"을(를) 삭제하시겠습니까?`)) onDeleteDoc(projectId, child.id); }}>
          <Trash2 size={11} />
        </button>
      </div>
      {dropIndicator?.id === child.id && dropIndicator.position === "below" && (
        <div style={{ height: 2, background: "var(--accent)", margin: "0 8px", borderRadius: 1 }} />
      )}
    </>
  );
}

/* ═══════════════════ Fonts ═══════════════════ */

const fontCSS = `@import url('https://fonts.googleapis.com/css2?family=Nanum+Gothic:wght@400;700;800&family=Montserrat:wght@300;400;500;600&display=swap');`;

/* ═══════════════════ Main App ═══════════════════ */

export default function Manuscrit() {
  const isDesktop = useMediaQuery("(min-width: 768px)");
  const [projects, setProjects] = useState(() => {
    try { const s = localStorage.getItem(LS_KEY); return s ? JSON.parse(s) : defaultProjects; } catch { return defaultProjects; }
  });
  const [activeDocId, setActiveDocId] = useState(null);
  const [leftOpen, setLeftOpen] = useState(false);
  const [rightOpen, setRightOpen] = useState(false);
  const [driveStatus, setDriveStatus] = useState("disconnected");
  const [driveFileId, setDriveFileId] = useState(null);
  const [syncMessage, setSyncMessage] = useState("");
  const [editingTitleId, setEditingTitleId] = useState(null);
  const [editingTitleValue, setEditingTitleValue] = useState("");
  const [contextMenuId, setContextMenuId] = useState(null);
  const [exportOpen, setExportOpen] = useState(false);
  const [exportSelected, setExportSelected] = useState(new Set());
  const [dragItem, setDragItem] = useState(null);
  const [dropIndicator, setDropIndicator] = useState(null);
  const editorRef = useRef(null);

  // ── Derived ──
  const activeDoc = useMemo(() => {
    for (const p of projects) for (const c of p.children) if (c.id === activeDocId) return { ...c, projectTitle: p.title, projectId: p.id };
    return null;
  }, [projects, activeDocId]);

  const charWithSpaces = activeDoc?.content?.length || 0;
  const charNoSpaces = useMemo(() => activeDoc?.content ? activeDoc.content.replace(/\s/g, "").length : 0, [activeDoc?.content]);

  // ── Persistence ──
  useEffect(() => { try { localStorage.setItem(LS_KEY, JSON.stringify(projects)); } catch {} }, [projects]);

  const pushToDrive = useCallback(async (data) => {
    if (driveStatus !== "connected" || !driveApi.accessToken) return;
    try {
      setSyncMessage("동기화 중...");
      const res = await driveApi.saveFile(data, driveFileId);
      if (res.id && !driveFileId) setDriveFileId(res.id);
      setSyncMessage("저장 완료"); setTimeout(() => setSyncMessage(""), 2000);
    } catch { setSyncMessage("동기화 실패"); }
  }, [driveStatus, driveFileId]);

  const debouncedSave = useDebounce(pushToDrive, AUTOSAVE_DELAY);
  const prevRef = useRef(projects);
  useEffect(() => { if (prevRef.current !== projects && driveStatus === "connected") debouncedSave(projects); prevRef.current = projects; }, [projects, driveStatus, debouncedSave]);

  // ── Actions ──
  const updateDoc = useCallback((id, field, val) => {
    setProjects(p => p.map(pr => ({ ...pr, children: pr.children.map(c => c.id === id ? { ...c, [field]: val } : c) })));
  }, []);

  const toggleProject = useCallback((id) => setProjects(p => p.map(pr => pr.id === id ? { ...pr, expanded: !pr.expanded } : pr)), []);

  const addProject = useCallback(() => {
    const np = { id: createId(), title: "새 프로젝트", expanded: true, children: [{ id: createId(), type: "synopsis", title: "시놉시스", content: "", memo: "" }] };
    setProjects(p => [...p, np]); setEditingTitleId(np.id); setEditingTitleValue(np.title);
  }, []);

  const addChapter = useCallback((pid) => {
    setProjects(p => p.map(pr => {
      if (pr.id !== pid) return pr;
      const n = pr.children.filter(c => c.type === "chapter").length;
      return { ...pr, expanded: true, children: [...pr.children, { id: createId(), type: "chapter", title: `제${n + 1}화`, content: "", memo: "", status: "draft" }] };
    }));
  }, []);

  const deleteDoc = useCallback((pid, did) => { if (activeDocId === did) setActiveDocId(null); setProjects(p => p.map(pr => pr.id !== pid ? pr : { ...pr, children: pr.children.filter(c => c.id !== did) })); }, [activeDocId]);

  const deleteProject = useCallback((pid) => {
    setProjects(p => { const pr = p.find(x => x.id === pid); if (pr?.children.some(c => c.id === activeDocId)) setActiveDocId(null); return p.filter(x => x.id !== pid); });
    setContextMenuId(null);
  }, [activeDocId]);

  const startRename = useCallback((id, title) => { setEditingTitleId(id); setEditingTitleValue(title); }, []);
  const cancelRename = useCallback(() => setEditingTitleId(null), []);
  const commitRename = useCallback((id) => {
    if (!editingTitleValue.trim()) { setEditingTitleId(null); return; }
    setProjects(p => p.map(pr => {
      if (pr.id === id) return { ...pr, title: editingTitleValue.trim() };
      return { ...pr, children: pr.children.map(c => c.id === id ? { ...c, title: editingTitleValue.trim() } : c) };
    })); setEditingTitleId(null);
  }, [editingTitleValue]);

  const cycleStatus = useCallback((docId) => {
    setProjects(p => p.map(pr => ({ ...pr, children: pr.children.map(c => c.id === docId ? { ...c, status: nextStatus(c.status || "draft") } : c) })));
  }, []);

  // ── Search ──
  const [searchQuery, setSearchQuery] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const searchResults = useMemo(() => {
    if (!searchQuery.trim()) return [];
    const q = searchQuery.toLowerCase();
    const results = [];
    for (const p of projects) {
      for (const c of p.children) {
        const inTitle = c.title.toLowerCase().includes(q);
        const inContent = c.content?.toLowerCase().includes(q);
        const inMemo = c.memo?.toLowerCase().includes(q);
        if (inTitle || inContent || inMemo) {
          let snippet = "";
          const src = inContent ? c.content : inMemo ? c.memo : c.title;
          const idx = src.toLowerCase().indexOf(q);
          if (idx !== -1) {
            const start = Math.max(0, idx - 20);
            const end = Math.min(src.length, idx + q.length + 30);
            snippet = (start > 0 ? "…" : "") + src.slice(start, end) + (end < src.length ? "…" : "");
          }
          results.push({ docId: c.id, projectTitle: p.title, docTitle: c.title, snippet, where: inContent ? "본문" : inMemo ? "메모" : "제목" });
        }
      }
    }
    return results;
  }, [searchQuery, projects]);

  // ── Drag & Drop ──
  const onDragStartProject = useCallback((e, id, idx) => { setDragItem({ type: "project", id, index: idx }); e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", ""); }, []);
  const onDragStartDoc = useCallback((e, id, pid, idx) => { setDragItem({ type: "doc", id, projectId: pid, index: idx }); e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", ""); }, []);

  const onDragOverProject = useCallback((e, id) => {
    e.preventDefault(); if (!dragItem || dragItem.type !== "project" || dragItem.id === id) { if (dragItem?.id === id) setDropIndicator(null); return; }
    const r = e.currentTarget.getBoundingClientRect(); setDropIndicator({ id, position: e.clientY < r.top + r.height / 2 ? "above" : "below" });
  }, [dragItem]);

  const onDragOverDoc = useCallback((e, id, pid) => {
    e.preventDefault(); if (!dragItem || dragItem.type !== "doc" || dragItem.id === id) { if (dragItem?.id === id) setDropIndicator(null); return; }
    const r = e.currentTarget.getBoundingClientRect(); setDropIndicator({ id, position: e.clientY < r.top + r.height / 2 ? "above" : "below", projectId: pid });
  }, [dragItem]);

  const onDrop = useCallback((e) => {
    e.preventDefault();
    if (!dragItem || !dropIndicator) { setDragItem(null); setDropIndicator(null); return; }
    if (dragItem.type === "project") {
      setProjects(prev => {
        const arr = [...prev]; const fi = arr.findIndex(p => p.id === dragItem.id); if (fi === -1) return prev;
        const [moved] = arr.splice(fi, 1); let ti = arr.findIndex(p => p.id === dropIndicator.id); if (ti === -1) return prev;
        if (dropIndicator.position === "below") ti++; arr.splice(ti, 0, moved); return arr;
      });
    } else {
      setProjects(prev => {
        const np = prev.map(p => ({ ...p, children: [...p.children] })); let moved = null;
        for (const p of np) { const i = p.children.findIndex(c => c.id === dragItem.id); if (i !== -1) { moved = p.children.splice(i, 1)[0]; break; } }
        if (!moved) return prev;
        const tp = np.find(p => p.id === (dropIndicator.projectId || dragItem.projectId)); if (!tp) return prev;
        let ti = tp.children.findIndex(c => c.id === dropIndicator.id);
        if (ti === -1) tp.children.push(moved); else { if (dropIndicator.position === "below") ti++; tp.children.splice(ti, 0, moved); }
        return np;
      });
    }
    setDragItem(null); setDropIndicator(null);
  }, [dragItem, dropIndicator]);

  const onDragEnd = useCallback(() => { setDragItem(null); setDropIndicator(null); }, []);

  // ── Google Drive ──
  const connectDrive = useCallback(async () => {
    setDriveStatus("connecting");
    try {
      if (!(await driveApi.init())) { setDriveStatus("disconnected"); setSyncMessage("Google API를 불러올 수 없습니다"); return; }
      await driveApi.requestToken(); setDriveStatus("connected");
      const f = await driveApi.findFile();
      if (f) { setDriveFileId(f.id); const d = await driveApi.readFile(f.id); if (Array.isArray(d) && d.length) { setProjects(d); setSyncMessage("드라이브에서 불러옴"); } }
      else { const r = await driveApi.saveFile(projects, null); if (r.id) setDriveFileId(r.id); setSyncMessage("드라이브에 저장됨"); }
      setTimeout(() => setSyncMessage(""), 3000);
    } catch { setDriveStatus("disconnected"); setSyncMessage("연결 실패"); }
  }, [projects]);

  const disconnectDrive = useCallback(() => { driveApi.accessToken = null; setDriveStatus("disconnected"); setDriveFileId(null); setSyncMessage(""); }, []);

  // ── Export ──
  const openExportModal = useCallback(() => { setExportSelected(new Set()); setExportOpen(true); }, []);
  const toggleExportItem = useCallback((id) => setExportSelected(p => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n; }), []);
  const toggleExportProject = useCallback((pid) => {
    const pr = projects.find(p => p.id === pid); if (!pr) return;
    const ids = pr.children.map(c => c.id);
    setExportSelected(p => { const n = new Set(p); const all = ids.every(i => n.has(i)); ids.forEach(i => all ? n.delete(i) : n.add(i)); return n; });
  }, [projects]);

  const executeExport = useCallback(() => {
    const parts = [];
    for (const p of projects) {
      const sel = p.children.filter(c => exportSelected.has(c.id)); if (!sel.length) continue;
      parts.push(`${"═".repeat(40)}\n  ${p.title}\n${"═".repeat(40)}\n`);
      for (const d of sel) { parts.push(`── ${d.title} ${"─".repeat(Math.max(0, 30 - d.title.length))}\n`); parts.push(d.content || "(빈 문서)"); parts.push("\n"); }
    }
    if (!parts.length) return;
    const blob = new Blob(["\uFEFF" + parts.join("\n")], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob); const a = document.createElement("a");
    a.href = url; a.download = `manuscrit_export_${new Date().toISOString().slice(0, 10)}.txt`; a.style.display = "none";
    document.body.appendChild(a); setTimeout(() => { a.click(); setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(url); }, 200); }, 0);
    setExportOpen(false);
  }, [projects, exportSelected]);

  // ── Close menus ──
  useEffect(() => { if (!contextMenuId) return; const h = () => setContextMenuId(null); setTimeout(() => document.addEventListener("click", h), 0); return () => document.removeEventListener("click", h); }, [contextMenuId]);

  const closeLeft = useCallback(() => setLeftOpen(false), []);

  // ── Shared props for sidebar items ──
  const itemProps = {
    activeDocId, editingTitleId, editingTitleValue, setEditingTitleValue, contextMenuId, dragItem, dropIndicator, isDesktop,
    onToggle: toggleProject, onStartRename: startRename, onCommitRename: commitRename, onCancelRename: cancelRename,
    onAddChapter: addChapter, onDeleteProject: deleteProject, onSetContextMenu: setContextMenuId,
    onDragStartProject, onDragOverProject, onDragStartDoc, onDragOverDoc, onDrop, onDragEnd,
    onSelectDoc: setActiveDocId, onCloseLeft: closeLeft, onDeleteDoc: deleteDoc, onCycleStatus: cycleStatus,
  };

  /* ─────── Sidebar ─────── */
  const sidebarContent = (
    <div className="flex flex-col h-full" style={{ fontFamily: "'Nanum Gothic', sans-serif" }}>
      <div className="flex items-center justify-between px-4 py-3 border-b" style={{ borderColor: "var(--border-subtle)" }}>
        <div className="flex items-center gap-2">
          <BookOpen size={16} style={{ color: "var(--accent)" }} />
          <span style={{ color: "var(--text-primary)", fontFamily: "'Montserrat', sans-serif", fontWeight: 600, fontSize: "0.8rem", letterSpacing: "0.08em" }}>MANUSCRIT</span>
        </div>
        <div className="flex items-center gap-1">
          <button onClick={() => { setSearchOpen(!searchOpen); if (searchOpen) setSearchQuery(""); }} className="p-1 rounded" style={{ color: searchOpen ? "var(--accent)" : "var(--text-muted)" }}><Search size={14} /></button>
          {!isDesktop && <button onClick={() => setLeftOpen(false)} className="p-1 rounded" style={{ color: "var(--text-muted)" }}><X size={18} /></button>}
        </div>
      </div>

      {/* Search bar */}
      {searchOpen && (
        <div className="px-3 py-2 animate-fade-in" style={{ borderBottom: "1px solid var(--border-subtle)" }}>
          <div className="flex items-center gap-2 px-2 py-1.5 rounded-md" style={{ background: "var(--input-bg)", border: "1px solid var(--border-subtle)" }}>
            <Search size={12} style={{ color: "var(--text-muted)", flexShrink: 0 }} />
            <input autoFocus value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} placeholder="전체 검색..."
              className="flex-1 text-xs outline-none" style={{ background: "transparent", color: "var(--text-primary)", fontFamily: "'Nanum Gothic', sans-serif" }} />
            {searchQuery && <button onClick={() => setSearchQuery("")} style={{ color: "var(--text-muted)" }}><X size={12} /></button>}
          </div>
          {searchQuery.trim() && (
            <div className="mt-2 max-h-48 overflow-y-auto" style={{ scrollbarWidth: "thin" }}>
              {searchResults.length === 0 ? (
                <p className="text-xs py-2 text-center" style={{ color: "var(--text-muted)" }}>결과 없음</p>
              ) : (
                searchResults.map((r, i) => (
                  <button key={i} className="flex flex-col w-full px-2 py-1.5 rounded text-left mb-0.5" style={{ transition: "background 150ms" }}
                    onMouseEnter={(e) => e.currentTarget.style.background = "var(--hover-bg)"} onMouseLeave={(e) => e.currentTarget.style.background = "transparent"}
                    onClick={() => { setActiveDocId(r.docId); setSearchQuery(""); setSearchOpen(false); if (!isDesktop) setLeftOpen(false); }}>
                    <div className="flex items-center gap-1.5">
                      <FileText size={10} style={{ color: "var(--text-muted)" }} />
                      <span className="text-xs font-bold truncate" style={{ color: "var(--text-primary)" }}>{r.docTitle}</span>
                      <span className="text-xs ml-auto" style={{ color: "var(--text-muted)", fontFamily: "'Montserrat', sans-serif", fontSize: "0.5rem" }}>{r.where}</span>
                    </div>
                    <p className="text-xs mt-0.5 truncate" style={{ color: "var(--text-muted)", fontSize: "0.65rem" }}>{r.snippet}</p>
                  </button>
                ))
              )}
              <p className="text-xs py-1 text-right" style={{ color: "var(--text-muted)", fontFamily: "'Montserrat', sans-serif", fontSize: "0.5rem" }}>{searchResults.length}건</p>
            </div>
          )}
        </div>
      )}

      <div className="flex-1 overflow-y-auto py-2" style={{ scrollbarWidth: "thin" }}>
        {projects.map((p, i) => <ProjectItem key={p.id} project={p} index={i} {...itemProps} />)}
      </div>
      <div className="px-4 py-2" style={{ borderTop: "1px solid var(--border-subtle)" }}>
        <button onClick={addProject} className="flex items-center gap-2 w-full px-3 py-2 rounded-md text-xs" style={{ color: "var(--text-secondary)", transition: "background 150ms" }}
          onMouseEnter={(e) => e.currentTarget.style.background = "var(--hover-bg)"} onMouseLeave={(e) => e.currentTarget.style.background = "transparent"}>
          <FolderPlus size={13} /><span>새 프로젝트</span>
        </button>
      </div>
      <div className="px-4 py-3" style={{ borderTop: "1px solid var(--border-subtle)", background: "var(--surface-recessed)" }}>
        {driveStatus === "connected" ? (
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2"><Cloud size={13} style={{ color: "#4ade80" }} /><span className="text-xs" style={{ color: "var(--text-muted)", fontFamily: "'Montserrat', sans-serif", fontWeight: 400, fontSize: "0.65rem" }}>{syncMessage || "Google Drive 연결됨"}</span></div>
            <button onClick={disconnectDrive} className="p-1 rounded" style={{ color: "var(--text-muted)" }}><LogOut size={12} /></button>
          </div>
        ) : driveStatus === "connecting" ? (
          <div className="flex items-center gap-2"><Loader2 size={13} className="animate-spin" style={{ color: "var(--accent)" }} /><span className="text-xs" style={{ color: "var(--text-muted)", fontFamily: "'Montserrat', sans-serif", fontWeight: 400, fontSize: "0.65rem" }}>연결 중...</span></div>
        ) : (
          <button onClick={connectDrive} className="flex items-center gap-2 w-full px-2 py-1.5 rounded-md text-xs" style={{ color: "var(--text-secondary)", transition: "background 150ms" }}
            onMouseEnter={(e) => e.currentTarget.style.background = "var(--hover-bg)"} onMouseLeave={(e) => e.currentTarget.style.background = "transparent"}>
            <CloudOff size={13} /><span style={{ fontFamily: "'Montserrat', sans-serif", fontWeight: 400, fontSize: "0.65rem" }}>Google Drive 연결</span>
          </button>
        )}
      </div>
    </div>
  );

  /* ─────── Memo ─────── */
  const memoContent = (
    <div className="flex flex-col h-full" style={{ fontFamily: "'Nanum Gothic', sans-serif" }}>
      <div className="flex items-center justify-between px-4 py-3 border-b" style={{ borderColor: "var(--border-subtle)" }}>
        <div className="flex items-center gap-2"><StickyNote size={14} style={{ color: "var(--accent-warm)" }} /><span style={{ color: "var(--text-primary)", fontFamily: "'Montserrat', sans-serif", fontWeight: 600, fontSize: "0.75rem", letterSpacing: "0.06em" }}>MEMO</span></div>
        {!isDesktop && <button onClick={() => setRightOpen(false)} className="p-1 rounded" style={{ color: "var(--text-muted)" }}><X size={18} /></button>}
      </div>
      <div className="flex-1 p-4">
        {activeDoc ? (
          <textarea value={activeDoc.memo} onChange={(e) => updateDoc(activeDocId, "memo", e.target.value)} placeholder="이 문서에 대한 메모를 작성하세요..."
            className="w-full h-full resize-none outline-none" style={{ background: "transparent", color: "var(--text-primary)", fontFamily: "'Nanum Gothic', sans-serif", fontSize: "0.8rem", lineHeight: 1.85 }} />
        ) : <div className="flex items-center justify-center h-full"><p className="text-xs" style={{ color: "var(--text-muted)" }}>문서를 선택하면 메모가 표시됩니다</p></div>}
      </div>
    </div>
  );

  /* ─────── Return ─────── */
  return (
    <>
      <style>{fontCSS}{`
        :root { --bg-base:#faf9f7;--surface:#fff;--surface-elevated:#fff;--surface-recessed:#f5f4f1;--border-subtle:#e8e6e1;--text-primary:#2c2a26;--text-secondary:#6b6860;--text-muted:#9e9a91;--accent:#7c6f5b;--accent-warm:#b8926a;--hover-bg:rgba(124,111,91,.07);--active-bg:rgba(124,111,91,.12);--input-bg:#f5f4f1;--editor-bg:#fffffe;--scrollbar-thumb:#d4d0c8; }
        @media(prefers-color-scheme:dark){ :root { --bg-base:#1a1916;--surface:#222019;--surface-elevated:#2a2822;--surface-recessed:#15140f;--border-subtle:#3a3830;--text-primary:#e8e4dc;--text-secondary:#a09b8f;--text-muted:#6e695e;--accent:#b8a88a;--accent-warm:#c9a77c;--hover-bg:rgba(184,168,138,.08);--active-bg:rgba(184,168,138,.14);--input-bg:#2a2822;--editor-bg:#1e1d18;--scrollbar-thumb:#4a4740; } }
        *{box-sizing:border-box;margin:0;padding:0} html,body,#root{height:100%;overflow:hidden}
        ::-webkit-scrollbar{width:5px} ::-webkit-scrollbar-track{background:transparent} ::-webkit-scrollbar-thumb{background:var(--scrollbar-thumb);border-radius:3px}
        textarea::placeholder{color:var(--text-muted);opacity:.7}
        @keyframes fadeIn{from{opacity:0;transform:translateY(4px)}to{opacity:1;transform:translateY(0)}} .animate-fade-in{animation:fadeIn .3s ease-out}
      `}</style>

      <div className="flex h-screen overflow-hidden" style={{ background: "var(--bg-base)", fontFamily: "'Nanum Gothic', sans-serif" }}>
        {/* Left */}
        {isDesktop ? (
          <div style={{ width: 260, minWidth: 260, background: "var(--surface)", borderRight: "1px solid var(--border-subtle)" }}>{sidebarContent}</div>
        ) : (
          <>
            {leftOpen && <div className="fixed inset-0 z-40" style={{ background: "rgba(0,0,0,.3)" }} onClick={() => setLeftOpen(false)} />}
            <div className="fixed inset-y-0 left-0 z-50" style={{ width: 280, background: "var(--surface)", transform: leftOpen ? "translateX(0)" : "translateX(-100%)", transition: "transform 300ms cubic-bezier(.4,0,.2,1)", boxShadow: leftOpen ? "4px 0 24px rgba(0,0,0,.12)" : "none" }}>{sidebarContent}</div>
          </>
        )}

        {/* Center */}
        <div className="flex-1 flex flex-col min-w-0 overflow-hidden" style={{ background: "var(--editor-bg)" }}>
          <div className="flex items-center justify-between px-4 py-2.5 flex-shrink-0" style={{ borderBottom: "1px solid var(--border-subtle)", background: "var(--surface)", minHeight: 48 }}>
            <div className="flex items-center gap-2 min-w-0">
              {!isDesktop && <button onClick={() => setLeftOpen(true)} className="p-1.5 rounded-md flex-shrink-0" style={{ color: "var(--text-muted)" }}><Menu size={18} /></button>}
              <div className="min-w-0">
                {activeDoc ? (
                  <div className="animate-fade-in">
                    <p className="text-xs truncate" style={{ color: "var(--text-muted)", fontFamily: "'Montserrat', sans-serif", fontWeight: 400, fontSize: "0.6rem", letterSpacing: "0.05em", textTransform: "uppercase" }}>{activeDoc.projectTitle}</p>
                    <p className="text-sm font-bold truncate" style={{ color: "var(--text-primary)", marginTop: 1 }}>{activeDoc.title}</p>
                  </div>
                ) : <p className="text-xs" style={{ color: "var(--text-muted)", fontFamily: "'Montserrat', sans-serif" }}>Manuscrit</p>}
              </div>
            </div>
            <div className="flex items-center gap-1 flex-shrink-0">
              {driveStatus === "connected" && syncMessage && <span className="text-xs mr-2 animate-fade-in" style={{ color: "var(--accent)", fontFamily: "'Montserrat', sans-serif", fontWeight: 400, fontSize: "0.6rem" }}>{syncMessage}</span>}
              {!isDesktop && <button onClick={() => setRightOpen(true)} className="p-1.5 rounded-md" style={{ color: "var(--text-muted)" }}><StickyNote size={18} /></button>}
            </div>
          </div>

          <div className="flex-1 overflow-y-auto" style={{ scrollbarWidth: "thin" }}>
            {activeDoc ? (
              <div className="max-w-3xl mx-auto px-6 py-8 md:px-12 md:py-12 animate-fade-in">
                <textarea ref={editorRef} value={activeDoc.content} onChange={(e) => updateDoc(activeDocId, "content", e.target.value)} placeholder="여기에 글을 쓰세요..."
                  className="w-full resize-none outline-none" style={{ background: "transparent", color: "var(--text-primary)", fontFamily: "'Nanum Gothic', sans-serif", fontSize: "0.95rem", lineHeight: 2.05, letterSpacing: "-0.01em", minHeight: "calc(100vh - 200px)" }} />
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center h-full gap-4 px-8">
                <div style={{ color: "var(--text-muted)", opacity: 0.4 }}><BookOpen size={48} strokeWidth={1} /></div>
                <p className="text-center text-sm" style={{ color: "var(--text-muted)", maxWidth: 280, lineHeight: 1.7 }}>왼쪽 프로젝트에서<br />문서를 선택하세요</p>
              </div>
            )}
          </div>

          <div className="flex items-center justify-between px-5 py-2 flex-shrink-0" style={{ borderTop: "1px solid var(--border-subtle)", background: "var(--surface)", minHeight: 32 }}>
            <div className="flex items-center gap-3">
              {driveStatus === "connected" ? <Cloud size={11} style={{ color: "#4ade80" }} /> : <CloudOff size={11} style={{ color: "var(--text-muted)", opacity: 0.4 }} />}
              <button onClick={openExportModal} className="flex items-center gap-1 px-2 py-0.5 rounded" style={{ color: "var(--text-muted)", fontSize: "0.6rem", fontFamily: "'Montserrat', sans-serif", fontWeight: 400, transition: "color 150ms" }}
                onMouseEnter={(e) => e.currentTarget.style.color = "var(--text-secondary)"} onMouseLeave={(e) => e.currentTarget.style.color = "var(--text-muted)"}>
                <Download size={10} /><span>추출</span>
              </button>
            </div>
            <div className="flex items-center gap-3" style={{ fontFamily: "'Montserrat', sans-serif", fontWeight: 300, fontSize: "0.6rem", letterSpacing: "0.04em", color: "var(--text-muted)" }}>
              <span>{charWithSpaces.toLocaleString()} <span style={{ opacity: 0.5 }}>characters</span></span>
              <span style={{ color: "var(--border-subtle)" }}>/</span>
              <span>{charNoSpaces.toLocaleString()} <span style={{ opacity: 0.5 }}>without spaces</span></span>
            </div>
          </div>
        </div>

        {/* Right */}
        {isDesktop ? (
          <div style={{ width: 280, minWidth: 280, background: "var(--surface)", borderLeft: "1px solid var(--border-subtle)" }}>{memoContent}</div>
        ) : (
          <>
            {rightOpen && <div className="fixed inset-0 z-40" style={{ background: "rgba(0,0,0,.3)" }} onClick={() => setRightOpen(false)} />}
            <div className="fixed inset-y-0 right-0 z-50" style={{ width: 280, background: "var(--surface)", transform: rightOpen ? "translateX(0)" : "translateX(100%)", transition: "transform 300ms cubic-bezier(.4,0,.2,1)", boxShadow: rightOpen ? "-4px 0 24px rgba(0,0,0,.12)" : "none" }}>{memoContent}</div>
          </>
        )}
      </div>

      {/* Export Modal */}
      {exportOpen && (
        <>
          <div className="fixed inset-0 z-[60]" style={{ background: "rgba(0,0,0,.4)", backdropFilter: "blur(2px)" }} onClick={() => setExportOpen(false)} />
          <div className="fixed z-[70] rounded-xl shadow-2xl overflow-hidden animate-fade-in" style={{ background: "var(--surface)", border: "1px solid var(--border-subtle)", top: "50%", left: "50%", transform: "translate(-50%,-50%)", width: "min(420px,90vw)", maxHeight: "70vh", display: "flex", flexDirection: "column" }}>
            <div className="flex items-center justify-between px-5 py-4" style={{ borderBottom: "1px solid var(--border-subtle)" }}>
              <div className="flex items-center gap-2"><FileDown size={16} style={{ color: "var(--accent)" }} /><span style={{ fontFamily: "'Montserrat', sans-serif", fontWeight: 600, fontSize: "0.85rem", color: "var(--text-primary)", letterSpacing: "0.04em" }}>TXT 추출</span></div>
              <button onClick={() => setExportOpen(false)} className="p-1 rounded" style={{ color: "var(--text-muted)" }}><X size={16} /></button>
            </div>
            <div className="flex-1 overflow-y-auto px-5 py-3" style={{ scrollbarWidth: "thin" }}>
              <p className="text-xs mb-3" style={{ color: "var(--text-muted)" }}>내보낼 문서를 선택하세요</p>
              {projects.map((p) => {
                const ids = p.children.map(c => c.id);
                const allS = ids.length > 0 && ids.every(i => exportSelected.has(i));
                const someS = ids.some(i => exportSelected.has(i));
                return (
                  <div key={p.id} className="mb-3">
                    <button className="flex items-center gap-2 w-full px-2 py-1.5 rounded-md text-left" style={{ transition: "background 150ms" }}
                      onMouseEnter={(e) => e.currentTarget.style.background = "var(--hover-bg)"} onMouseLeave={(e) => e.currentTarget.style.background = "transparent"}
                      onClick={() => toggleExportProject(p.id)}>
                      {allS ? <CheckSquare size={14} style={{ color: "var(--accent)" }} /> : <Square size={14} style={{ color: someS ? "var(--accent)" : "var(--text-muted)", opacity: someS ? .6 : .4 }} />}
                      <FolderOpen size={13} style={{ color: "var(--accent-warm)" }} /><span className="text-xs font-bold" style={{ color: "var(--text-primary)" }}>{p.title}</span>
                    </button>
                    <div className="ml-7 mt-1 space-y-0.5">
                      {p.children.map(c => (
                        <button key={c.id} className="flex items-center gap-2 w-full px-2 py-1 rounded text-left" style={{ transition: "background 150ms" }}
                          onMouseEnter={(e) => e.currentTarget.style.background = "var(--hover-bg)"} onMouseLeave={(e) => e.currentTarget.style.background = "transparent"}
                          onClick={() => toggleExportItem(c.id)}>
                          {exportSelected.has(c.id) ? <CheckSquare size={13} style={{ color: "var(--accent)" }} /> : <Square size={13} style={{ color: "var(--text-muted)", opacity: .4 }} />}
                          {c.type === "synopsis" ? <StickyNote size={11} style={{ color: "var(--accent-warm)" }} /> : <FileText size={11} style={{ color: "var(--text-muted)" }} />}
                          <span className="text-xs" style={{ color: "var(--text-secondary)" }}>{c.title}</span>
                          {c.content && <span className="text-xs ml-auto" style={{ color: "var(--text-muted)", fontFamily: "'Montserrat', sans-serif", fontWeight: 300, fontSize: "0.55rem" }}>{c.content.length.toLocaleString()}자</span>}
                        </button>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="flex items-center justify-between px-5 py-3" style={{ borderTop: "1px solid var(--border-subtle)", background: "var(--surface-recessed)" }}>
              <span className="text-xs" style={{ color: "var(--text-muted)", fontFamily: "'Montserrat', sans-serif", fontWeight: 400, fontSize: "0.65rem" }}>{exportSelected.size}개 선택됨</span>
              <button onClick={executeExport} disabled={exportSelected.size === 0} className="flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-xs"
                style={{ background: exportSelected.size > 0 ? "var(--accent)" : "var(--border-subtle)", color: exportSelected.size > 0 ? "#fff" : "var(--text-muted)", fontFamily: "'Montserrat', sans-serif", fontWeight: 500, fontSize: "0.75rem", cursor: exportSelected.size > 0 ? "pointer" : "not-allowed" }}>
                <Download size={13} /> TXT 저장
              </button>
            </div>
          </div>
        </>
      )}
    </>
  );
}
