from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


def replace_once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f"{label}: expected one match, found {count}")
    return text.replace(old, new, 1)


def replace_if_missing(text: str, marker: str, old: str, new: str, label: str) -> str:
    if marker in text:
        return text
    return replace_once(text, old, new, label)


code_path = ROOT / "apps-script" / "Code.gs"
code = code_path.read_text(encoding="utf-8")
code = replace_if_missing(
    code,
    "function startInventorySession(request)",
    "function startInventorySession(inspector)",
    "function startInventorySession(request)",
    "change session start signature",
)
code = replace_if_missing(
    code,
    "var sessionRequest = normalizeSessionStartRequest(request, year);",
    """    var existingSessionIds = readColumnValuesByHeader_(sessionSheet, '세션ID');
    var year = new Date().getFullYear();
    var sessionId = makeSessionId(year, existingSessionIds);""",
    """    var existingSessionIds = readColumnValuesByHeader_(sessionSheet, '세션ID');
    var year = new Date().getFullYear();
    var sessionRequest = normalizeSessionStartRequest(request, year);
    var sessionId = makeSessionId(year, existingSessionIds);""",
    "normalize session start request",
)
code = replace_if_missing(
    code,
    "'조사표기명': sessionRequest.displayName",
    """      '조사명': year + '년 정기 전수조사',
      '기준연도': year,
      '조사유형': '정기',
      '조사범위': '전체',""",
    """      '조사명': sessionRequest.displayName,
      '기준연도': year,
      '조사유형': sessionRequest.category,
      '조사구분': sessionRequest.category,
      '조사차수': sessionRequest.round,
      '조사표기명': sessionRequest.displayName,
      '조사목적': sessionRequest.purpose,
      '조사범위': '전체',""",
    "write repeated-session metadata",
)
code = replace_if_missing(
    code,
    "'생성자': normalizeInspector_(sessionRequest.inspector)",
    "'생성자': normalizeInspector_(inspector)",
    "'생성자': normalizeInspector_(sessionRequest.inspector)",
    "use normalized session inspector",
)
code = replace_if_missing(
    code,
    "buildInventoryRecords(sessionId, baselineAssets, errorMap)",
    """    var errorMap = readErrorMap_(getRequiredSheet_(ss, INVENTORY_CONFIG.SHEETS.ERROR_REVIEW));
    var records = buildInventoryRecords(sessionId, assets, errorMap);""",
    """    var errorMap = readErrorMap_(getRequiredSheet_(ss, INVENTORY_CONFIG.SHEETS.ERROR_REVIEW));
    var currentStateMap = ss.getSheetByName(INVENTORY_CONFIG.SHEETS.CURRENT_STATE)
      ? readCurrentStateMap_(ss)
      : {};
    var baselineAssets = assets.map(function (asset) {
      return selectInspectionBaseline(asset, currentStateMap[asset.systemId]);
    });
    var records = buildInventoryRecords(sessionId, baselineAssets, errorMap);""",
    "use current-state baselines",
)
code_path.write_text(code, encoding="utf-8")

index_path = ROOT / "apps-script" / "Index.html"
index = index_path.read_text(encoding="utf-8")
index = replace_if_missing(
    index,
    "startInventorySession(request){return this.call('startInventorySession',request)}",
    "startInventorySession(inspector){return this.call('startInventorySession',inspector)}",
    "startInventorySession(request){return this.call('startInventorySession',request)}",
    "update session API request",
)
index = replace_if_missing(
    index,
    "function Home({bootstrap,inspector,setInspector,sessionDraft,setSessionDraft,onStart,onContinue,busy})",
    "function Home({bootstrap,inspector,setInspector,onStart,onContinue,busy})",
    "function Home({bootstrap,inspector,setInspector,sessionDraft,setSessionDraft,onStart,onContinue,busy})",
    "extend Home props",
)
old_inactive = """<div className=\"field\"><label>조사자 이름</label><input className=\"input\" value=${inspector} onInput=${e=>setInspector(e.target.value)} placeholder=\"예: 이건희\"/></div><div style=${{height:'12px'}}></div><button className=\"btn primary\" disabled=${busy||!inspector.trim()} onClick=${onStart}>${busy?'생성 중…':'전수조사 시작'}</button>"""
new_inactive = """<div className=\"field\"><label>조사자 이름</label><input className=\"input\" value=${inspector} onInput=${e=>setInspector(e.target.value)} placeholder=\"예: 이건희\"/></div><div style=${{height:'10px'}}></div><div className=\"field\"><label>조사구분</label><select id=\"session-category\" className=\"select\" value=${sessionDraft.category} onChange=${e=>setSessionDraft(x=>({...x,category:e.target.value}))}><option value=\"정기\">정기</option><option value=\"수시\">수시</option><option value=\"특별\">특별</option><option value=\"재조사\">재조사</option></select></div><div style=${{height:'10px'}}></div><div className=\"field\"><label>조사차수</label><input id=\"session-round\" className=\"input\" type=\"number\" min=\"1\" step=\"1\" value=${sessionDraft.round} onInput=${e=>setSessionDraft(x=>({...x,round:e.target.value}))}/></div><div style=${{height:'10px'}}></div><div className=\"field\"><label>조사표기명</label><input id=\"session-display-name\" className=\"input\" value=${sessionDraft.displayName} onInput=${e=>setSessionDraft(x=>({...x,displayName:e.target.value}))} placeholder=\"비워두면 자동 생성\"/></div><div style=${{height:'10px'}}></div><div className=\"field\"><label>조사목적</label><textarea id=\"session-purpose\" className=\"textarea\" value=${sessionDraft.purpose} onInput=${e=>setSessionDraft(x=>({...x,purpose:e.target.value}))} placeholder=\"비워두면 조사구분에 맞게 자동 생성\"></textarea></div><div style=${{height:'12px'}}></div><button className=\"btn primary\" disabled=${busy||!inspector.trim()} onClick=${onStart}>${busy?'생성 중…':'전수조사 시작'}</button>"""
index = replace_if_missing(
    index,
    'id="session-category"',
    old_inactive,
    new_inactive,
    "add repeated-session form fields",
)
index = replace_if_missing(
    index,
    "[sessionDraft,setSessionDraft]=useState({category:'정기',round:1,displayName:'',purpose:''})",
    "[inspector,setInspector]=useState(()=>localStorage.getItem('inventoryInspector')||''),[selectedFloor,setSelectedFloor]",
    "[inspector,setInspector]=useState(()=>localStorage.getItem('inventoryInspector')||''),[sessionDraft,setSessionDraft]=useState({category:'정기',round:1,displayName:'',purpose:''}),[selectedFloor,setSelectedFloor]",
    "add repeated-session App state",
)
index = replace_if_missing(
    index,
    "api.startInventorySession({inspector:",
    """async function startSession(){setBusy(true);setError('');try{const data=await api.startInventorySession(inspector.trim());setBootstrap(data);setView('floors');setToast(`${data.summary.total}개 비품 조사 준비 완료`)}catch(e){setError(errText(e))}finally{setBusy(false)}}""",
    """async function startSession(){setBusy(true);setError('');try{const data=await api.startInventorySession({inspector:inspector.trim(),category:sessionDraft.category,round:Number(sessionDraft.round||1),displayName:sessionDraft.displayName.trim(),purpose:sessionDraft.purpose.trim()});setBootstrap(data);setView('floors');setToast(`${data.summary.total}개 비품 조사 준비 완료`)}catch(e){setError(errText(e))}finally{setBusy(false)}}""",
    "send repeated-session request",
)
index = replace_if_missing(
    index,
    "sessionDraft=${sessionDraft} setSessionDraft=${setSessionDraft}",
    "setInspector=${setInspector} onStart=${startSession}",
    "setInspector=${setInspector} sessionDraft=${sessionDraft} setSessionDraft=${setSessionDraft} onStart=${startSession}",
    "pass repeated-session Home props",
)
index_path.write_text(index, encoding="utf-8")
print("repeated-session patches applied")
