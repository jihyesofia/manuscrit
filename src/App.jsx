import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import {
  FolderOpen, FileText, Trash2, ChevronRight, ChevronDown,
  Cloud, CloudOff, BookOpen, StickyNote, Menu, X,
  Loader2, LogOut, FolderPlus, FilePlus, MoreVertical,
  Download, FileDown, Square, CheckSquare, GripVertical,
  Search, Bold, Italic, Underline, Type, ALargeSmall,
  ChevronUp, Minus, RefreshCw, Save, LogIn
} from "lucide-react";
import { initializeApp } from "firebase/app";
import { getAuth, signInWithPopup, GoogleAuthProvider, onAuthStateChanged, signOut as fbSignOut } from "firebase/auth";
import { getDatabase, ref, set, onValue } from "firebase/database";

/* ═══════════════════ Firebase Config ═══════════════════ */

const firebaseConfig = {
  apiKey: "AIzaSyAh--KiEkuWgBjb7QLBIp-BumHM4xe859M",
  authDomain: "manuscrit-6151d.firebaseapp.com",
  databaseURL: "https://manuscrit-6151d-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "manuscrit-6151d",
  storageBucket: "manuscrit-6151d.firebasestorage.app",
  messagingSenderId: "354621007300",
  appId: "1:354621007300:web:32359d257405aea14f3091"
};

const fbApp = initializeApp(firebaseConfig);
const fbAuth = getAuth(fbApp);
const fbDb = getDatabase(fbApp);
const googleProvider = new GoogleAuthProvider();

/* ═══════════════════ Constants ═══════════════════ */

const AUTOSAVE_DELAY = 2000;
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
      { id: createId(), type: "chapter", title: "1화: 재회", content: "", memo: "도입부 — 5년 만의 재회 장면으로 시작\n분위기: 비 오는 서울, 을지로 골목", status: "revision" },
      { id: createId(), type: "chapter", title: "2화: 균열", content: "", memo: "", status: "draft" },
    ],
  },
  {
    id: createId(), title: "프래질 프랙탈", expanded: false,
    children: [
      { id: createId(), type: "synopsis", title: "시놉시스", content: "부서지기 쉬운 것들이 만들어내는 무한한 패턴에 관하여.", memo: "SF + 문학 융합\n프랙탈 구조를 서사에 반영" },
      { id: createId(), type: "chapter", title: "1화: 반복", content: "", memo: "", status: "draft" },
    ],
  },
  {
    id: createId(), title: "오프 밸런스", expanded: false,
    children: [
      { id: createId(), type: "synopsis", title: "시놉시스", content: "균형을 잃은 두 사람이 서로에게 기대어 서는 법을 배우는 이야기.", memo: "기업 로맨스\nM&A 소재" },
      { id: createId(), type: "chapter", title: "1화: 인수", content: "", memo: "", status: "complete" },
      { id: createId(), type: "chapter", title: "2화: 실사", content: "", memo: "", status: "revision" },
      { id: createId(), type: "chapter", title: "3화: 합병", content: "", memo: "", status: "draft" },
    ],
  },
];

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
    didLP.current = false; const t = e.touches?.[0] || e;
    startPos.current = { x: t.clientX, y: t.clientY };
    timerRef.current = setTimeout(() => { didLP.current = true; onLongPress(e); }, delay);
  }, [onLongPress, delay]);
  const move = useCallback((e) => {
    if (!timerRef.current) return; const t = e.touches?.[0] || e;
    if (Math.abs(t.clientX - startPos.current.x) > 10 || Math.abs(t.clientY - startPos.current.y) > 10) { clearTimeout(timerRef.current); timerRef.current = null; }
  }, []);
  const end = useCallback((e) => { if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null; } if (!didLP.current && onClick) onClick(e); }, [onClick]);
  const cancel = useCallback(() => { if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null; } }, []);
  return useMemo(() => ({ onMouseDown: start, onMouseMove: move, onMouseUp: end, onMouseLeave: cancel, onTouchStart: start, onTouchMove: move, onTouchEnd: end, onTouchCancel: cancel }), [start, move, end, cancel]);
}

/* ═══════════════════ Sub-Components ═══════════════════ */

function ProjectItem({ project, index, activeDocId, editingTitleId, editingTitleValue, setEditingTitleValue, contextMenuId, dragItem, dropIndicator, onToggle, onStartRename, onCommitRename, onCancelRename, onAddChapter, onDeleteProject, onSetContextMenu, onDragStartProject, onDragOverProject, onDragStartDoc, onDragOverDoc, onDrop, onDragEnd, onSelectDoc, isDesktop, onCloseLeft, onDeleteDoc, onCycleStatus }) {
  const lp = useLongPress(
    useCallback(() => onStartRename(project.id, project.title), [project.id, project.title, onStartRename]),
    useCallback(() => onToggle(project.id), [project.id, onToggle]),
  );
  return (
    <div className="mb-1" onDrop={onDrop} onDragEnd={onDragEnd}>
      {dropIndicator?.id === project.id && dropIndicator.position === "above" && <div style={{ height: 2, background: "var(--accent)", margin: "0 8px", borderRadius: 1 }} />}
      <div className="flex items-center gap-1 px-2 py-2 mx-2 rounded-md cursor-grab group" draggable
        onDragStart={(e) => onDragStartProject(e, project.id, index)} onDragOver={(e) => onDragOverProject(e, project.id, index)}
        style={{ transition: "background 150ms", opacity: dragItem?.id === project.id ? 0.4 : 1 }}
        onMouseEnter={(e) => { if (!dragItem) e.currentTarget.style.background = "var(--hover-bg)"; }}
        onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}>
        <div className="flex-shrink-0 cursor-grab opacity-0 group-hover:opacity-40" style={{ color: "var(--text-muted)" }}><GripVertical size={12} /></div>
        <button onClick={() => onToggle(project.id)} className="flex-shrink-0" style={{ color: "var(--text-muted)" }}>
          {project.expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        </button>
        <FolderOpen size={14} style={{ color: "var(--accent)", flexShrink: 0 }} />
        {editingTitleId === project.id ? (
          <input autoFocus value={editingTitleValue} onChange={(e) => setEditingTitleValue(e.target.value)}
            onBlur={() => onCommitRename(project.id)} onKeyDown={(e) => { if (e.key === "Enter") onCommitRename(project.id); if (e.key === "Escape") onCancelRename(); }}
            className="flex-1 text-xs px-1 py-0.5 rounded outline-none"
            style={{ background: "var(--input-bg)", color: "var(--text-primary)", border: "1px solid var(--border-subtle)", fontFamily: "'Nanum Gothic', sans-serif" }}
            onClick={(e) => e.stopPropagation()} />
        ) : (
          <span className="flex-1 text-xs font-bold truncate select-none" style={{ color: "var(--text-primary)" }} {...lp} onDoubleClick={() => onStartRename(project.id, project.title)}>{project.title}</span>
        )}
        <div className="relative flex-shrink-0">
          <button className="opacity-0 group-hover:opacity-100 p-0.5 rounded" style={{ color: "var(--text-muted)", transition: "opacity 150ms" }}
            onClick={(e) => { e.stopPropagation(); onSetContextMenu(contextMenuId === project.id ? null : project.id); }}><MoreVertical size={13} /></button>
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
      {dropIndicator?.id === project.id && dropIndicator.position === "below" && <div style={{ height: 2, background: "var(--accent)", margin: "0 8px", borderRadius: 1 }} />}
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
      {dropIndicator?.id === child.id && dropIndicator.position === "above" && <div style={{ height: 2, background: "var(--accent)", margin: "0 8px", borderRadius: 1 }} />}
      <div className="flex items-center gap-1.5 px-2 py-1.5 mx-2 rounded-md cursor-grab group" draggable
        onDragStart={(e) => onDragStartDoc(e, child.id, projectId, index)} onDragOver={(e) => onDragOverDoc(e, child.id, projectId, index)}
        onDrop={onDrop} onDragEnd={onDragEnd}
        style={{ background: activeDocId === child.id ? "var(--active-bg)" : "transparent", transition: "background 150ms", opacity: dragItem?.id === child.id ? 0.4 : 1 }}
        onMouseEnter={(e) => { if (activeDocId !== child.id && !dragItem) e.currentTarget.style.background = "var(--hover-bg)"; }}
        onMouseLeave={(e) => { if (activeDocId !== child.id) e.currentTarget.style.background = "transparent"; }}>
        <div className="flex-shrink-0 cursor-grab opacity-0 group-hover:opacity-40" style={{ color: "var(--text-muted)" }}><GripVertical size={10} /></div>
        {child.type === "synopsis" ? <StickyNote size={12} style={{ color: "var(--accent-warm)", flexShrink: 0 }} /> : <FileText size={12} style={{ color: "var(--text-muted)", flexShrink: 0 }} />}
        {editingTitleId === child.id ? (
          <input autoFocus value={editingTitleValue} onChange={(e) => setEditingTitleValue(e.target.value)}
            onBlur={() => onCommitRename(child.id)} onKeyDown={(e) => { if (e.key === "Enter") onCommitRename(child.id); if (e.key === "Escape") onCancelRename(); }}
            className="flex-1 text-xs px-1 py-0.5 rounded outline-none"
            style={{ background: "var(--input-bg)", color: "var(--text-primary)", border: "1px solid var(--border-subtle)", fontFamily: "'Nanum Gothic', sans-serif" }}
            onClick={(e) => e.stopPropagation()} />
        ) : (
          <span className="flex-1 text-xs truncate select-none"
            style={{ color: activeDocId === child.id ? "var(--text-primary)" : "var(--text-secondary)", fontWeight: activeDocId === child.id ? 700 : 400 }}
            {...lp} onDoubleClick={() => onStartRename(child.id, child.title)}>{child.title}</span>
        )}
        {child.type === "chapter" && (
          <button onClick={(e) => { e.stopPropagation(); onCycleStatus(child.id); }} title={st.label}
            className="flex-shrink-0 p-0.5 rounded-full" style={{ transition: "transform 150ms" }}
            onMouseEnter={(e) => e.currentTarget.style.transform = "scale(1.3)"} onMouseLeave={(e) => e.currentTarget.style.transform = "scale(1)"}>
            <div style={{ width: 7, height: 7, borderRadius: "50%", background: st.color }} />
          </button>
        )}
        <button className="opacity-0 group-hover:opacity-100 p-0.5 rounded flex-shrink-0" style={{ color: "var(--text-muted)", transition: "opacity 150ms" }}
          onClick={(e) => { e.stopPropagation(); if (confirm(`"${child.title}"을(를) 삭제하시겠습니까?`)) onDeleteDoc(projectId, child.id); }}><Trash2 size={11} /></button>
      </div>
      {dropIndicator?.id === child.id && dropIndicator.position === "below" && <div style={{ height: 2, background: "var(--accent)", margin: "0 8px", borderRadius: 1 }} />}
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
  const [editingTitleId, setEditingTitleId] = useState(null);
  const [editingTitleValue, setEditingTitleValue] = useState("");
  const [contextMenuId, setContextMenuId] = useState(null);
  const [exportOpen, setExportOpen] = useState(false);
  const [exportSelected, setExportSelected] = useState(new Set());
  const [dragItem, setDragItem] = useState(null);
  const [dropIndicator, setDropIndicator] = useState(null);
  const [formatBarOpen, setFormatBarOpen] = useState(true);
  const [editorStyle, setEditorStyle] = useState({ fontSize: 0.95, lineHeight: 2.05, bold: false, italic: false, underline: false });
  const editorRef = useRef(null);
  const editorScrollRef = useRef(null);

  // ── Firebase State ──
  const [fbUser, setFbUser] = useState(null);
  const [syncStatus, setSyncStatus] = useState("disconnected"); // disconnected | connected | syncing
  const [syncMessage, setSyncMessage] = useState("");
  const skipNextSnapshot = useRef(false);

  // ── Firebase Auth Listener ──
  useEffect(() => {
    const unsub = onAuthStateChanged(fbAuth, (user) => {
      setFbUser(user);
      if (user) setSyncStatus("connected");
      else { setSyncStatus("disconnected"); setSyncMessage(""); }
    });
    return unsub;
  }, []);

  // ── Realtime Database Listener ──
  useEffect(() => {
    if (!fbUser) return;
    const dbRef = ref(fbDb, `users/${fbUser.uid}/projects`);
    const unsub = onValue(dbRef, (snap) => {
      if (skipNextSnapshot.current) { skipNextSnapshot.current = false; return; }
      const data = snap.val();
      if (data && Array.isArray(data)) {
        setProjects(data);
        setSyncMessage("동기화됨");
        setTimeout(() => setSyncMessage(""), 1500);
      }
    }, (err) => { console.error("DB listen error:", err); setSyncMessage("동기화 오류"); });
    return () => unsub();
  }, [fbUser]);

  // ── Resizable Panels (Desktop) ──
  const [sidebarWidth, setSidebarWidth] = useState(260);
  const [memoWidth, setMemoWidth] = useState(280);
  const [resizing, setResizing] = useState(null);

  useEffect(() => {
    if (!resizing) return;
    const onMove = (e) => {
      if (resizing === "sidebar") setSidebarWidth(Math.max(180, Math.min(420, e.clientX)));
      else if (resizing === "memo") setMemoWidth(Math.max(180, Math.min(420, window.innerWidth - e.clientX)));
    };
    const onUp = () => setResizing(null);
    document.addEventListener("mousemove", onMove); document.addEventListener("mouseup", onUp);
    document.body.style.cursor = "col-resize"; document.body.style.userSelect = "none";
    return () => { document.removeEventListener("mousemove", onMove); document.removeEventListener("mouseup", onUp); document.body.style.cursor = ""; document.body.style.userSelect = ""; };
  }, [resizing]);

  const FONT_SIZES = [0.8, 0.85, 0.9, 0.95, 1.0, 1.1, 1.2];
  const LINE_HEIGHTS = [1.5, 1.7, 1.85, 2.05, 2.2, 2.4];
  const cycleFontSize = useCallback((dir) => {
    setEditorStyle(prev => { const idx = FONT_SIZES.indexOf(prev.fontSize); const next = idx === -1 ? 3 : Math.max(0, Math.min(FONT_SIZES.length - 1, idx + dir)); return { ...prev, fontSize: FONT_SIZES[next] }; });
  }, []);
  const cycleLineHeight = useCallback((dir) => {
    setEditorStyle(prev => { const idx = LINE_HEIGHTS.indexOf(prev.lineHeight); const next = idx === -1 ? 3 : Math.max(0, Math.min(LINE_HEIGHTS.length - 1, idx + dir)); return { ...prev, lineHeight: LINE_HEIGHTS[next] }; });
  }, []);

  // ── Derived ──
  const activeDoc = useMemo(() => {
    for (const p of projects) for (const c of p.children) if (c.id === activeDocId) return { ...c, projectTitle: p.title, projectId: p.id };
    return null;
  }, [projects, activeDocId]);

  const charWithSpaces = activeDoc?.content?.length || 0;
  const charNoSpaces = useMemo(() => activeDoc?.content ? activeDoc.content.replace(/\s/g, "").length : 0, [activeDoc?.content]);

  // (auto-resize removed — textarea fills container and scrolls naturally)

  // ── LocalStorage (offline fallback) ──
  useEffect(() => { try { localStorage.setItem(LS_KEY, JSON.stringify(projects)); } catch {} }, [projects]);

  // ── Realtime Database Auto-Save ──
  const saveToDb = useCallback(async (data) => {
    if (!fbUser) return;
    try {
      skipNextSnapshot.current = true;
      await set(ref(fbDb, `users/${fbUser.uid}/projects`), data);
      setSyncMessage("저장 완료"); setTimeout(() => setSyncMessage(""), 1500);
    } catch (e) { console.error("Save error:", e); setSyncMessage("저장 실패"); skipNextSnapshot.current = false; }
  }, [fbUser]);

  const debouncedSave = useDebounce(saveToDb, AUTOSAVE_DELAY);
  const prevRef = useRef(projects);
  useEffect(() => {
    if (prevRef.current !== projects && fbUser) debouncedSave(projects);
    prevRef.current = projects;
  }, [projects, fbUser, debouncedSave]);

  // ── Actions ──
  const updateDoc = useCallback((id, field, val) => {
    setProjects(p => p.map(pr => ({ ...pr, children: pr.children.map(c => c.id === id ? { ...c, [field]: val } : c) })));
  }, []);

  // ── Smart Typography ──
  const handleEditorChange = useCallback((e) => {
    const ta = e.target; let val = ta.value; let cur = ta.selectionStart;
    if (cur >= 3 && val.slice(cur - 3, cur) === "...") { val = val.slice(0, cur - 3) + "\u2026" + val.slice(cur); cur -= 2; }
    if (cur >= 1 && val[cur - 1] === '"') { const before = cur >= 2 ? val[cur - 2] : ""; const isOpen = !before || before === " " || before === "\n" || before === "\t" || before === "(" || before === "\u2014"; val = val.slice(0, cur - 1) + (isOpen ? "\u201C" : "\u201D") + val.slice(cur); }
    if (cur >= 1 && val[cur - 1] === "'") { const before = cur >= 2 ? val[cur - 2] : ""; const isOpen = !before || before === " " || before === "\n" || before === "\t" || before === "("; val = val.slice(0, cur - 1) + (isOpen ? "\u2018" : "\u2019") + val.slice(cur); }
    updateDoc(activeDocId, "content", val);
    requestAnimationFrame(() => { if (editorRef.current) { editorRef.current.selectionStart = cur; editorRef.current.selectionEnd = cur; } });
  }, [activeDocId, updateDoc]);

  const toggleProject = useCallback((id) => setProjects(p => p.map(pr => pr.id === id ? { ...pr, expanded: !pr.expanded } : pr)), []);

  const addProject = useCallback(() => {
    const np = { id: createId(), title: "새 프로젝트", expanded: true, children: [{ id: createId(), type: "synopsis", title: "시놉시스", content: "", memo: "" }] };
    setProjects(p => [...p, np]); setEditingTitleId(np.id); setEditingTitleValue(np.title);
  }, []);

  const addChapter = useCallback((pid) => {
    setProjects(p => p.map(pr => {
      if (pr.id !== pid) return pr;
      const n = pr.children.filter(c => c.type === "chapter").length;
      return { ...pr, expanded: true, children: [...pr.children, { id: createId(), type: "chapter", title: `${n + 1}화`, content: "", memo: "", status: "draft" }] };
    }));
  }, []);

  const deleteDoc = useCallback((pid, did) => { if (activeDocId === did) setActiveDocId(null); setProjects(p => p.map(pr => pr.id !== pid ? pr : { ...pr, children: pr.children.filter(c => c.id !== did) })); }, [activeDocId]);
  const deleteProject = useCallback((pid) => { setProjects(p => { const pr = p.find(x => x.id === pid); if (pr?.children.some(c => c.id === activeDocId)) setActiveDocId(null); return p.filter(x => x.id !== pid); }); setContextMenuId(null); }, [activeDocId]);

  const startRename = useCallback((id, title) => { setEditingTitleId(id); setEditingTitleValue(title); }, []);
  const cancelRename = useCallback(() => setEditingTitleId(null), []);
  const commitRename = useCallback((id) => {
    if (!editingTitleValue.trim()) { setEditingTitleId(null); return; }
    setProjects(p => p.map(pr => { if (pr.id === id) return { ...pr, title: editingTitleValue.trim() }; return { ...pr, children: pr.children.map(c => c.id === id ? { ...c, title: editingTitleValue.trim() } : c) }; }));
    setEditingTitleId(null);
  }, [editingTitleValue]);

  const cycleStatus = useCallback((docId) => { setProjects(p => p.map(pr => ({ ...pr, children: pr.children.map(c => c.id === docId ? { ...c, status: nextStatus(c.status || "draft") } : c) }))); }, []);

  // ── Search ──
  const [searchQuery, setSearchQuery] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const searchResults = useMemo(() => {
    if (!searchQuery.trim()) return [];
    const q = searchQuery.toLowerCase(); const results = [];
    for (const p of projects) { for (const c of p.children) {
      const inTitle = c.title.toLowerCase().includes(q); const inContent = c.content?.toLowerCase().includes(q); const inMemo = c.memo?.toLowerCase().includes(q);
      if (inTitle || inContent || inMemo) {
        const src = inContent ? c.content : inMemo ? c.memo : c.title; const idx = src.toLowerCase().indexOf(q);
        let snippet = ""; if (idx !== -1) { const s = Math.max(0, idx - 20); const e = Math.min(src.length, idx + q.length + 30); snippet = (s > 0 ? "…" : "") + src.slice(s, e) + (e < src.length ? "…" : ""); }
        results.push({ docId: c.id, projectTitle: p.title, docTitle: c.title, snippet, where: inContent ? "본문" : inMemo ? "메모" : "제목" });
      }
    }} return results;
  }, [searchQuery, projects]);

  // ── Drag & Drop ──
  const onDragStartProject = useCallback((e, id, idx) => { setDragItem({ type: "project", id, index: idx }); e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", ""); }, []);
  const onDragStartDoc = useCallback((e, id, pid, idx) => { setDragItem({ type: "doc", id, projectId: pid, index: idx }); e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", ""); }, []);
  const onDragOverProject = useCallback((e, id) => { e.preventDefault(); if (!dragItem || dragItem.type !== "project" || dragItem.id === id) { if (dragItem?.id === id) setDropIndicator(null); return; } const r = e.currentTarget.getBoundingClientRect(); setDropIndicator({ id, position: e.clientY < r.top + r.height / 2 ? "above" : "below" }); }, [dragItem]);
  const onDragOverDoc = useCallback((e, id, pid) => { e.preventDefault(); if (!dragItem || dragItem.type !== "doc" || dragItem.id === id) { if (dragItem?.id === id) setDropIndicator(null); return; } const r = e.currentTarget.getBoundingClientRect(); setDropIndicator({ id, position: e.clientY < r.top + r.height / 2 ? "above" : "below", projectId: pid }); }, [dragItem]);
  const onDrop = useCallback((e) => {
    e.preventDefault(); if (!dragItem || !dropIndicator) { setDragItem(null); setDropIndicator(null); return; }
    if (dragItem.type === "project") { setProjects(prev => { const arr = [...prev]; const fi = arr.findIndex(p => p.id === dragItem.id); if (fi === -1) return prev; const [moved] = arr.splice(fi, 1); let ti = arr.findIndex(p => p.id === dropIndicator.id); if (ti === -1) return prev; if (dropIndicator.position === "below") ti++; arr.splice(ti, 0, moved); return arr; }); }
    else { setProjects(prev => { const np = prev.map(p => ({ ...p, children: [...p.children] })); let moved = null; for (const p of np) { const i = p.children.findIndex(c => c.id === dragItem.id); if (i !== -1) { moved = p.children.splice(i, 1)[0]; break; } } if (!moved) return prev; const tp = np.find(p => p.id === (dropIndicator.projectId || dragItem.projectId)); if (!tp) return prev; let ti = tp.children.findIndex(c => c.id === dropIndicator.id); if (ti === -1) tp.children.push(moved); else { if (dropIndicator.position === "below") ti++; tp.children.splice(ti, 0, moved); } return np; }); }
    setDragItem(null); setDropIndicator(null);
  }, [dragItem, dropIndicator]);
  const onDragEnd = useCallback(() => { setDragItem(null); setDropIndicator(null); }, []);

  // ── Firebase Auth Actions ──
  const signIn = useCallback(async () => {
    try { await signInWithPopup(fbAuth, googleProvider); } catch (e) { console.error("Sign-in error:", e); setSyncMessage("로그인 실패"); }
  }, []);
  const signOutUser = useCallback(async () => { await fbSignOut(fbAuth); setSyncStatus("disconnected"); setSyncMessage(""); }, []);

  // ── Manual Save & Refresh ──
  const forceSave = useCallback(() => { if (fbUser) saveToDb(projects); }, [fbUser, projects, saveToDb]);

  // ── Export ──
  const openExportModal = useCallback(() => { setExportSelected(new Set()); setExportOpen(true); }, []);
  const toggleExportItem = useCallback((id) => setExportSelected(p => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n; }), []);
  const toggleExportProject = useCallback((pid) => { const pr = projects.find(p => p.id === pid); if (!pr) return; const ids = pr.children.map(c => c.id); setExportSelected(p => { const n = new Set(p); const all = ids.every(i => n.has(i)); ids.forEach(i => all ? n.delete(i) : n.add(i)); return n; }); }, [projects]);
  const executeExport = useCallback(() => {
    const parts = []; for (const p of projects) { const sel = p.children.filter(c => exportSelected.has(c.id)); if (!sel.length) continue; parts.push(`${"═".repeat(40)}\n  ${p.title}\n${"═".repeat(40)}\n`); for (const d of sel) { parts.push(`── ${d.title} ${"─".repeat(Math.max(0, 30 - d.title.length))}\n`); parts.push(d.content || "(빈 문서)"); parts.push("\n"); } }
    if (!parts.length) return; const blob = new Blob(["\uFEFF" + parts.join("\n")], { type: "text/plain;charset=utf-8" }); const url = URL.createObjectURL(blob); const a = document.createElement("a"); a.href = url; a.download = `manuscrit_export_${new Date().toISOString().slice(0, 10)}.txt`; a.style.display = "none"; document.body.appendChild(a); setTimeout(() => { a.click(); setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(url); }, 200); }, 0); setExportOpen(false);
  }, [projects, exportSelected]);

  useEffect(() => { if (!contextMenuId) return; const h = () => setContextMenuId(null); setTimeout(() => document.addEventListener("click", h), 0); return () => document.removeEventListener("click", h); }, [contextMenuId]);
  const closeLeft = useCallback(() => setLeftOpen(false), []);

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
        <div className="flex items-center gap-2 cursor-pointer" onClick={() => { setActiveDocId(null); if (!isDesktop) setLeftOpen(false); }}>
          <BookOpen size={16} style={{ color: "var(--accent)" }} />
          <span style={{ color: "var(--text-primary)", fontFamily: "'Montserrat', sans-serif", fontWeight: 600, fontSize: "0.8rem", letterSpacing: "0.08em" }}>MANUSCRIT</span>
        </div>
        <div className="flex items-center gap-1">
          <button onClick={() => { setSearchOpen(!searchOpen); if (searchOpen) setSearchQuery(""); }} className="p-1 rounded" style={{ color: searchOpen ? "var(--accent)" : "var(--text-muted)" }}><Search size={14} /></button>
          {!isDesktop && <button onClick={() => setLeftOpen(false)} className="p-1 rounded" style={{ color: "var(--text-muted)" }}><X size={18} /></button>}
        </div>
      </div>
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
              {searchResults.length === 0 ? <p className="text-xs py-2 text-center" style={{ color: "var(--text-muted)" }}>결과 없음</p> : searchResults.map((r, i) => (
                <button key={i} className="flex flex-col w-full px-2 py-1.5 rounded text-left mb-0.5" style={{ transition: "background 150ms" }}
                  onMouseEnter={(e) => e.currentTarget.style.background = "var(--hover-bg)"} onMouseLeave={(e) => e.currentTarget.style.background = "transparent"}
                  onClick={() => { setActiveDocId(r.docId); setSearchQuery(""); setSearchOpen(false); if (!isDesktop) setLeftOpen(false); }}>
                  <div className="flex items-center gap-1.5"><FileText size={10} style={{ color: "var(--text-muted)" }} /><span className="text-xs font-bold truncate" style={{ color: "var(--text-primary)" }}>{r.docTitle}</span><span className="text-xs ml-auto" style={{ color: "var(--text-muted)", fontFamily: "'Montserrat', sans-serif", fontSize: "0.5rem" }}>{r.where}</span></div>
                  <p className="text-xs mt-0.5 truncate" style={{ color: "var(--text-muted)", fontSize: "0.65rem" }}>{r.snippet}</p>
                </button>
              ))}
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
      {/* Firebase Status */}
      <div className="px-4 py-3" style={{ borderTop: "1px solid var(--border-subtle)", background: "var(--surface-recessed)" }}>
        {fbUser ? (
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Cloud size={13} style={{ color: "#4ade80" }} />
              <span className="text-xs" style={{ color: "var(--text-muted)", fontFamily: "'Montserrat', sans-serif", fontWeight: 400, fontSize: "0.65rem" }}>{syncMessage || fbUser.email?.split("@")[0]}</span>
            </div>
            <div className="flex items-center gap-0.5">
              <button onClick={forceSave} className="p-1 rounded" style={{ color: "var(--text-muted)" }} title="수동 저장"><Save size={12} /></button>
              <button onClick={signOutUser} className="p-1 rounded" style={{ color: "var(--text-muted)" }} title="로그아웃"><LogOut size={12} /></button>
            </div>
          </div>
        ) : (
          <button onClick={signIn} className="flex items-center gap-2 w-full px-2 py-1.5 rounded-md text-xs" style={{ color: "var(--text-secondary)", transition: "background 150ms" }}
            onMouseEnter={(e) => e.currentTarget.style.background = "var(--hover-bg)"} onMouseLeave={(e) => e.currentTarget.style.background = "transparent"}>
            <LogIn size={13} /><span style={{ fontFamily: "'Montserrat', sans-serif", fontWeight: 400, fontSize: "0.65rem" }}>Google 로그인</span>
          </button>
        )}
      </div>
    </div>
  );

  /* ─────── Memo ─────── */
  const memoContent = (
    <div className="flex flex-col h-full" style={{ fontFamily: "'Nanum Gothic', sans-serif" }}>
      <div className="flex items-center justify-between px-4 border-b" style={{ borderColor: "var(--border-subtle)", paddingTop: "calc(0.75rem + env(safe-area-inset-top, 0px))", paddingBottom: "0.75rem" }}>
        <div className="flex items-center gap-2"><StickyNote size={14} style={{ color: "var(--accent-warm)" }} /><span style={{ color: "var(--text-primary)", fontFamily: "'Montserrat', sans-serif", fontWeight: 600, fontSize: "0.75rem", letterSpacing: "0.06em" }}>MEMO</span></div>
        {!isDesktop && <button onClick={() => setRightOpen(false)} className="p-2 rounded-md" style={{ color: "var(--text-muted)" }}><X size={20} /></button>}
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
        *{box-sizing:border-box;margin:0;padding:0} html,body,#root{height:100dvh;height:100vh;overflow:hidden;background:var(--bg-base)}
        ::-webkit-scrollbar{width:5px} ::-webkit-scrollbar-track{background:transparent} ::-webkit-scrollbar-thumb{background:var(--scrollbar-thumb);border-radius:3px}
        textarea::placeholder{color:var(--text-muted);opacity:.7}
        @keyframes fadeIn{from{opacity:0;transform:translateY(4px)}to{opacity:1;transform:translateY(0)}} .animate-fade-in{animation:fadeIn .3s ease-out}
        @keyframes slideDown{from{opacity:0;max-height:0}to{opacity:1;max-height:60px}} .animate-slide-down{animation:slideDown .2s ease-out}
      `}</style>

      <div className="flex h-screen overflow-hidden" style={{ background: "var(--bg-base)", fontFamily: "'Nanum Gothic', sans-serif" }}>
        {/* Left */}
        {isDesktop ? (
          <>
            <div style={{ width: sidebarWidth, minWidth: 180, background: "var(--surface)", borderRight: "1px solid var(--border-subtle)", flexShrink: 0 }}>{sidebarContent}</div>
            <div onMouseDown={() => setResizing("sidebar")} style={{ width: 4, cursor: "col-resize", background: "transparent", flexShrink: 0, position: "relative", zIndex: 10 }}
              onMouseEnter={(e) => e.currentTarget.style.background = "var(--accent)"} onMouseLeave={(e) => { if (!resizing) e.currentTarget.style.background = "transparent"; }} />
          </>
        ) : (
          <>
            {leftOpen && <div className="fixed inset-0 z-40" style={{ background: "rgba(0,0,0,.3)" }} onClick={() => setLeftOpen(false)} />}
            <div className="fixed inset-y-0 left-0 z-50" style={{ width: 280, background: "var(--surface)", transform: leftOpen ? "translateX(0)" : "translateX(-100%)", transition: "transform 300ms cubic-bezier(.4,0,.2,1)", boxShadow: leftOpen ? "4px 0 24px rgba(0,0,0,.12)" : "none", paddingTop: "env(safe-area-inset-top)" }}>{sidebarContent}</div>
          </>
        )}

        {/* Center */}
        <div className="flex-1 flex flex-col min-w-0 overflow-hidden" style={{ background: "var(--editor-bg)" }}>
          <div className="flex items-center justify-between px-4 flex-shrink-0" style={{ borderBottom: "1px solid var(--border-subtle)", background: "var(--surface)", minHeight: 48, paddingTop: "calc(0.5rem + env(safe-area-inset-top, 0px))", paddingBottom: "0.5rem" }}>
            <div className="flex items-center gap-2 min-w-0 flex-1">
              {!isDesktop && <button onClick={() => setLeftOpen(true)} className="p-1.5 rounded-md flex-shrink-0" style={{ color: "var(--text-muted)" }}><Menu size={18} /></button>}
              <button className="min-w-0 flex-1 text-left" onClick={() => { setActiveDocId(null); setFormatBarOpen(false); }} style={{ background: "none", border: "none", cursor: "pointer", padding: 0 }}>
                {activeDoc ? (
                  <div className="animate-fade-in">
                    <p className="text-xs truncate" style={{ color: "var(--text-muted)", fontFamily: "'Montserrat', sans-serif", fontWeight: 400, fontSize: "0.6rem", letterSpacing: "0.05em", textTransform: "uppercase" }}>{activeDoc.projectTitle}</p>
                    <p className="text-sm font-bold truncate" style={{ color: "var(--text-primary)", marginTop: 1 }}>{activeDoc.title}</p>
                  </div>
                ) : <p className="text-xs" style={{ color: "var(--text-muted)", fontFamily: "'Montserrat', sans-serif" }}>Manuscrit</p>}
              </button>
            </div>
            <div className="flex items-center gap-1 flex-shrink-0">
              {fbUser && syncMessage && <span className="text-xs mr-2 animate-fade-in" style={{ color: "var(--accent)", fontFamily: "'Montserrat', sans-serif", fontWeight: 400, fontSize: "0.6rem" }}>{syncMessage}</span>}
              {activeDoc && <button onClick={() => setFormatBarOpen(!formatBarOpen)} className="p-1.5 rounded-md" style={{ color: formatBarOpen ? "var(--accent)" : "var(--text-muted)" }}><Type size={16} /></button>}
              {!isDesktop && <button onClick={() => setRightOpen(true)} className="p-1.5 rounded-md" style={{ color: "var(--text-muted)" }}><StickyNote size={18} /></button>}
            </div>
          </div>

          {formatBarOpen && activeDoc && (
            <div className="flex items-center gap-1 px-4 py-1.5 flex-shrink-0 animate-slide-down overflow-x-auto" style={{ borderBottom: "1px solid var(--border-subtle)", background: "var(--surface-recessed)" }}>
              <button onClick={() => setEditorStyle(p => ({ ...p, bold: !p.bold }))} className="p-1.5 rounded-md" style={{ color: editorStyle.bold ? "var(--accent)" : "var(--text-muted)", background: editorStyle.bold ? "var(--active-bg)" : "transparent" }}><Bold size={14} /></button>
              <button onClick={() => setEditorStyle(p => ({ ...p, italic: !p.italic }))} className="p-1.5 rounded-md" style={{ color: editorStyle.italic ? "var(--accent)" : "var(--text-muted)", background: editorStyle.italic ? "var(--active-bg)" : "transparent" }}><Italic size={14} /></button>
              <button onClick={() => setEditorStyle(p => ({ ...p, underline: !p.underline }))} className="p-1.5 rounded-md" style={{ color: editorStyle.underline ? "var(--accent)" : "var(--text-muted)", background: editorStyle.underline ? "var(--active-bg)" : "transparent" }}><Underline size={14} /></button>
              <div style={{ width: 1, height: 16, background: "var(--border-subtle)", margin: "0 4px" }} />
              <div className="flex items-center gap-0.5">
                <button onClick={() => cycleFontSize(-1)} className="p-1 rounded" style={{ color: "var(--text-muted)" }}><Minus size={12} /></button>
                <span style={{ fontFamily: "'Montserrat', sans-serif", fontSize: "0.6rem", color: "var(--text-secondary)", minWidth: 32, textAlign: "center", fontWeight: 500 }}>{Math.round(editorStyle.fontSize * 100)}%</span>
                <button onClick={() => cycleFontSize(1)} className="p-1 rounded" style={{ color: "var(--text-muted)" }}><ALargeSmall size={12} /></button>
              </div>
              <div style={{ width: 1, height: 16, background: "var(--border-subtle)", margin: "0 4px" }} />
              <div className="flex items-center gap-0.5">
                <span style={{ fontFamily: "'Montserrat', sans-serif", fontSize: "0.5rem", color: "var(--text-muted)", marginRight: 2 }}>행간</span>
                <button onClick={() => cycleLineHeight(-1)} className="p-1 rounded" style={{ color: "var(--text-muted)" }}><Minus size={12} /></button>
                <span style={{ fontFamily: "'Montserrat', sans-serif", fontSize: "0.6rem", color: "var(--text-secondary)", minWidth: 28, textAlign: "center", fontWeight: 500 }}>{editorStyle.lineHeight.toFixed(1)}</span>
                <button onClick={() => cycleLineHeight(1)} className="p-1 rounded" style={{ color: "var(--text-muted)" }}><ChevronUp size={12} /></button>
              </div>
            </div>
          )}

          {activeDoc ? (
            <div ref={editorScrollRef} className="flex-1 flex flex-col overflow-hidden">
              <div className="flex-1 max-w-3xl w-full mx-auto px-4 md:px-6 overflow-hidden">
                <textarea ref={editorRef} value={activeDoc.content} onChange={handleEditorChange} placeholder="여기에 글을 쓰세요..."
                  className="w-full h-full resize-none outline-none" style={{
                    background: "transparent", color: "var(--text-primary)", fontFamily: "'Nanum Gothic', sans-serif",
                    fontSize: `${editorStyle.fontSize}rem`, lineHeight: editorStyle.lineHeight, letterSpacing: "-0.01em",
                    fontWeight: editorStyle.bold ? 700 : 400, fontStyle: editorStyle.italic ? "italic" : "normal",
                    textDecoration: editorStyle.underline ? "underline" : "none", paddingTop: "1rem", paddingBottom: "2rem"
                  }} />
              </div>
            </div>
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center gap-4 px-8">
              <div style={{ color: "var(--text-muted)", opacity: 0.4 }}><BookOpen size={48} strokeWidth={1} /></div>
              <p className="text-center text-sm" style={{ color: "var(--text-muted)", maxWidth: 280, lineHeight: 1.7 }}>왼쪽 프로젝트에서<br />문서를 선택하세요</p>
            </div>
          )}

          <div className="flex items-center justify-between px-5 flex-shrink-0" style={{ borderTop: "1px solid var(--border-subtle)", background: "var(--surface)", minHeight: 32, paddingTop: "0.5rem", paddingBottom: "calc(0.5rem + env(safe-area-inset-bottom, 0px))" }}>
            <div className="flex items-center gap-3">
              {fbUser ? <Cloud size={11} style={{ color: "#4ade80" }} /> : <CloudOff size={11} style={{ color: "var(--text-muted)", opacity: 0.4 }} />}
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
          <>
            <div onMouseDown={() => setResizing("memo")} style={{ width: 4, cursor: "col-resize", background: "transparent", flexShrink: 0, position: "relative", zIndex: 10 }}
              onMouseEnter={(e) => e.currentTarget.style.background = "var(--accent)"} onMouseLeave={(e) => { if (!resizing) e.currentTarget.style.background = "transparent"; }} />
            <div style={{ width: memoWidth, minWidth: 180, background: "var(--surface)", borderLeft: "1px solid var(--border-subtle)", flexShrink: 0 }}>{memoContent}</div>
          </>
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
                const ids = p.children.map(c => c.id); const allS = ids.length > 0 && ids.every(i => exportSelected.has(i)); const someS = ids.some(i => exportSelected.has(i));
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
