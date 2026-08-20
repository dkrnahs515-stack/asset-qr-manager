from pathlib import Path

path = Path('apps-script/Index.html')
text = path.read_text(encoding='utf-8')

replacements = [
    (
        "counts",
        "const counts=useMemo(()=>({pending:items.filter(x=>x.result==='미확인').length,issues:items.filter(x=>['위치변경','상태이상','미발견'].includes(x.result)).length,unregistered:items.filter(x=>x.targetType==='미등록비품').length}),[items]);",
        "const counts=useMemo(()=>({pending:items.filter(x=>x.result==='미확인').length,issues:items.filter(x=>['위치변경','상태이상','미발견'].includes(x.result)).length,unregistered:items.filter(x=>x.targetType==='미등록비품').length,completed:items.filter(x=>x.targetType!=='미등록비품'&&x.result!=='미확인').length}),[items]);",
    ),
    (
        "search filtering",
        "const visible=useMemo(()=>{const q=search.trim().toLowerCase();return items.filter(x=>filter==='all'||(filter==='pending'&&x.result==='미확인')||(filter==='issues'&&['위치변경','상태이상','미발견'].includes(x.result))||(filter==='unregistered'&&x.targetType==='미등록비품')).filter(x=>!q||",
        "const visible=useMemo(()=>{const q=search.trim().toLowerCase();const matchesFilter=x=>q?true:filter==='all'||(filter==='pending'&&x.result==='미확인')||(filter==='issues'&&['위치변경','상태이상','미발견'].includes(x.result))||(filter==='unregistered'&&x.targetType==='미등록비품')||(filter==='completed'&&x.targetType!=='미등록비품'&&x.result!=='미확인');return items.filter(matchesFilter).filter(x=>!q||",
    ),
    (
        "filter chips",
        "<button className=${'chip '+(filter==='unregistered'?'active':'')} onClick=${()=>setFilter('unregistered')}>미등록 ${counts.unregistered}</button><button className=${'chip '+(filter==='all'?'active':'')} onClick=${()=>setFilter('all')}>전체 ${items.length}</button>",
        "<button className=${'chip '+(filter==='unregistered'?'active':'')} onClick=${()=>setFilter('unregistered')}>미등록 ${counts.unregistered}</button><button className=${'chip '+(filter==='completed'?'active':'')} onClick=${()=>setFilter('completed')}>완료 ${counts.completed}</button><button className=${'chip '+(filter==='all'?'active':'')} onClick=${()=>setFilter('all')}>전체(완료 포함) ${items.length}</button>",
    ),
]

for label, old, new in replacements:
    if old not in text:
        raise SystemExit(f'Expected {label} source text was not found.')
    text = text.replace(old, new, 1)

path.write_text(text, encoding='utf-8')
print('Updated room filter UX in apps-script/Index.html')
