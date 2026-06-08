import { initializeApp } from "https://www.gstatic.com/firebasejs/12.14.0/firebase-app.js";
import {
  getAuth,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut
} from "https://www.gstatic.com/firebasejs/12.14.0/firebase-auth.js";
import {
  getFirestore,
  collection,
  addDoc,
  doc,
  updateDoc,
  deleteDoc,
  getDoc,
  getDocs,
  query,
  where,
  onSnapshot,
  serverTimestamp,
  writeBatch
} from "https://www.gstatic.com/firebasejs/12.14.0/firebase-firestore.js";
import { firebaseConfig } from "./firebase-config.js";

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => Array.from(document.querySelectorAll(selector));

const els = {
  syncStatus: $("#syncStatus"),
  loginPanel: $("#loginPanel"),
  appPanel: $("#appPanel"),
  loginForm: $("#loginForm"),
  loginEmail: $("#loginEmail"),
  loginPassword: $("#loginPassword"),
  logoutBtn: $("#logoutBtn"),
  totalCount: $("#totalCount"),
  usingCount: $("#usingCount"),
  checkCount: $("#checkCount"),
  inactiveCount: $("#inactiveCount"),
  searchInput: $("#searchInput"),
  categoryFilter: $("#categoryFilter"),
  statusFilter: $("#statusFilter"),
  resultCount: $("#resultCount"),
  tableBody: $("#assetTableBody"),
  resetFiltersBtn: $("#resetFiltersBtn"),
  addBtn: $("#addBtn"),
  scanBtn: $("#scanBtn"),
  printBtn: $("#printBtn"),
  exportBtn: $("#exportBtn"),
  importBtn: $("#importBtn"),
  csvFile: $("#csvFile"),
  assetDialog: $("#assetDialog"),
  assetForm: $("#assetForm"),
  dialogTitle: $("#dialogTitle"),
  closeDialogBtn: $("#closeDialogBtn"),
  cancelBtn: $("#cancelBtn"),
  deleteBtn: $("#deleteBtn"),
  assetId: $("#assetId"),
  assetNo: $("#assetNo"),
  name: $("#name"),
  category: $("#category"),
  categoryList: $("#categoryList"),
  status: $("#status"),
  location: $("#location"),
  manager: $("#manager"),
  purchaseDate: $("#purchaseDate"),
  price: $("#price"),
  model: $("#model"),
  serial: $("#serial"),
  memo: $("#memo"),
  qrPreview: $("#qrPreview"),
  qrHint: $("#qrHint"),
  downloadQrBtn: $("#downloadQrBtn"),
  scanDialog: $("#scanDialog"),
  closeScanBtn: $("#closeScanBtn"),
  reader: $("#reader"),
  scanMessage: $("#scanMessage"),
  printSheet: $("#printSheet"),
  toast: $("#toast")
};

let assets = [];
let unsubscribeAssets = null;
let currentUser = null;
let scanner = null;
let scannerRunning = false;
let toastTimer = null;

const FORM_FIELDS = [
  "assetNo",
  "name",
  "category",
  "status",
  "location",
  "manager",
  "purchaseDate",
  "price",
  "model",
  "serial",
  "memo"
];

function toast(message) {
  clearTimeout(toastTimer);
  els.toast.textContent = message;
  els.toast.classList.remove("hidden");
  toastTimer = setTimeout(() => els.toast.classList.add("hidden"), 2400);
}

function setSyncStatus(text, mode = "muted") {
  els.syncStatus.textContent = text;
  els.syncStatus.className = `pill ${mode}`;
}

function escapeHtml(value = "") {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function normalize(value = "") {
  return String(value).trim().toLowerCase();
}

function formatDate(timestamp) {
  if (!timestamp) return "-";
  const date = typeof timestamp.toDate === "function" ? timestamp.toDate() : new Date(timestamp);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleDateString("ko-KR", { year: "2-digit", month: "2-digit", day: "2-digit" });
}

function statusBadge(status) {
  const value = status || "미지정";
  let cls = "gray";
  if (["사용중", "보관중"].includes(value)) cls = "success";
  if (["수리중", "점검필요", "폐기예정"].includes(value)) cls = "warn";
  if (["분실"].includes(value)) cls = "danger";
  return `<span class="badge ${cls}">${escapeHtml(value)}</span>`;
}

function getAssetUrl(assetId) {
  const url = new URL(window.location.href);
  url.search = "";
  url.hash = "";
  url.searchParams.set("asset", assetId);
  return url.toString();
}

function makeQr(target, text, size = 180) {
  target.innerHTML = "";
  if (!window.QRCode) {
    target.textContent = "QR 라이브러리 로딩 중입니다.";
    return;
  }
  new window.QRCode(target, {
    text,
    width: size,
    height: size,
    correctLevel: window.QRCode.CorrectLevel.M
  });
}

function downloadQrFrom(target, filename) {
  const canvas = target.querySelector("canvas");
  const img = target.querySelector("img");
  const link = document.createElement("a");
  link.download = `${filename}.png`;
  if (canvas) link.href = canvas.toDataURL("image/png");
  else if (img) link.href = img.src;
  else {
    toast("다운로드할 QR이 없습니다.");
    return;
  }
  link.click();
}

function getFilteredAssets() {
  const keyword = normalize(els.searchInput.value);
  const category = els.categoryFilter.value;
  const status = els.statusFilter.value;

  return assets
    .filter((asset) => {
      const target = [
        asset.assetNo,
        asset.name,
        asset.category,
        asset.location,
        asset.manager,
        asset.model,
        asset.serial,
        asset.memo
      ].map(normalize).join(" ");
      return !keyword || target.includes(keyword);
    })
    .filter((asset) => !category || asset.category === category)
    .filter((asset) => !status || asset.status === status)
    .sort((a, b) => String(a.assetNo || "").localeCompare(String(b.assetNo || ""), "ko"));
}

function renderStats() {
  els.totalCount.textContent = assets.length;
  els.usingCount.textContent = assets.filter((a) => a.status === "사용중").length;
  els.checkCount.textContent = assets.filter((a) => ["수리중", "점검필요", "폐기예정"].includes(a.status)).length;
  els.inactiveCount.textContent = assets.filter((a) => ["분실"].includes(a.status)).length;
}

function renderCategoryFilters() {
  const categories = [...new Set(assets.map((a) => a.category).filter(Boolean))].sort((a, b) => a.localeCompare(b, "ko"));
  const selected = els.categoryFilter.value;
  els.categoryFilter.innerHTML = `<option value="">전체</option>` + categories.map((c) => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join("");
  els.categoryFilter.value = categories.includes(selected) ? selected : "";
  els.categoryList.innerHTML = categories.map((c) => `<option value="${escapeHtml(c)}"></option>`).join("");
}

function renderTable() {
  const filtered = getFilteredAssets();
  els.resultCount.textContent = `${filtered.length}개 표시 중`;

  if (!filtered.length) {
    els.tableBody.innerHTML = `<tr><td colspan="8" class="empty">조건에 맞는 비품이 없습니다.</td></tr>`;
    return;
  }

  els.tableBody.innerHTML = filtered.map((asset) => `
    <tr>
      <td><span class="asset-no">${escapeHtml(asset.assetNo || "-")}</span></td>
      <td>${escapeHtml(asset.name || "-")}</td>
      <td>${escapeHtml(asset.category || "-")}</td>
      <td>${escapeHtml(asset.location || "-")}</td>
      <td>${statusBadge(asset.status)}</td>
      <td>${escapeHtml(asset.manager || "-")}</td>
      <td>${formatDate(asset.updatedAt || asset.createdAt)}</td>
      <td>
        <div class="actions">
          <button data-action="edit" data-id="${asset.id}">수정</button>
          <button data-action="qr" data-id="${asset.id}">QR</button>
        </div>
      </td>
    </tr>
  `).join("");
}

function renderAll() {
  renderStats();
  renderCategoryFilters();
  renderTable();
}

function clearForm() {
  els.assetId.value = "";
  FORM_FIELDS.forEach((field) => {
    if (els[field]) els[field].value = "";
  });
  els.status.value = "사용중";
  els.qrPreview.innerHTML = "";
  els.qrHint.textContent = "저장 후 QR이 생성됩니다.";
  els.deleteBtn.classList.add("hidden");
}

function fillForm(asset) {
  clearForm();
  els.assetId.value = asset.id;
  FORM_FIELDS.forEach((field) => {
    if (!els[field]) return;
    els[field].value = asset[field] ?? "";
  });
  els.dialogTitle.textContent = "비품 수정";
  els.deleteBtn.classList.remove("hidden");
  const qrUrl = getAssetUrl(asset.id);
  makeQr(els.qrPreview, qrUrl, 190);
  els.qrHint.textContent = qrUrl;
}

function openAddDialog() {
  clearForm();
  els.dialogTitle.textContent = "비품 등록";
  els.assetNo.value = suggestAssetNo();
  els.assetDialog.showModal();
}

function openEditDialog(assetId) {
  const asset = assets.find((item) => item.id === assetId);
  if (!asset) {
    toast("비품 정보를 찾을 수 없습니다.");
    return;
  }
  fillForm(asset);
  els.assetDialog.showModal();
}

function suggestAssetNo() {
  const year = new Date().getFullYear();
  const prefix = `GSY-${year}-`;
  const nums = assets
    .map((a) => String(a.assetNo || ""))
    .filter((no) => no.startsWith(prefix))
    .map((no) => Number(no.replace(prefix, "")))
    .filter((n) => Number.isFinite(n));
  const next = nums.length ? Math.max(...nums) + 1 : 1;
  return `${prefix}${String(next).padStart(3, "0")}`;
}

function formToAsset() {
  return {
    assetNo: els.assetNo.value.trim(),
    name: els.name.value.trim(),
    category: els.category.value.trim(),
    status: els.status.value,
    location: els.location.value.trim(),
    manager: els.manager.value.trim(),
    purchaseDate: els.purchaseDate.value || "",
    price: els.price.value ? Number(els.price.value) : 0,
    model: els.model.value.trim(),
    serial: els.serial.value.trim(),
    memo: els.memo.value.trim()
  };
}

async function saveAsset(event) {
  event.preventDefault();
  const assetId = els.assetId.value;
  const data = formToAsset();
  if (!data.assetNo || !data.name) {
    toast("비품번호와 품명은 필수입니다.");
    return;
  }

  const duplicated = assets.find((a) => a.assetNo === data.assetNo && a.id !== assetId);
  if (duplicated) {
    toast("이미 등록된 비품번호입니다.");
    return;
  }

  try {
    if (assetId) {
      await updateDoc(doc(db, "assets", assetId), {
        ...data,
        updatedAt: serverTimestamp(),
        updatedBy: currentUser?.email || "unknown"
      });
      await addLog("update", assetId, data.assetNo, data.name);
      toast("비품 정보가 수정되었습니다.");
    } else {
      const ref = await addDoc(collection(db, "assets"), {
        ...data,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
        createdBy: currentUser?.email || "unknown",
        updatedBy: currentUser?.email || "unknown"
      });
      await addLog("create", ref.id, data.assetNo, data.name);
      toast("비품이 등록되었습니다.");
    }
    els.assetDialog.close();
    removeAssetQueryParam();
  } catch (error) {
    console.error(error);
    toast("저장 중 오류가 발생했습니다.");
  }
}

async function deleteAsset() {
  const assetId = els.assetId.value;
  const assetNo = els.assetNo.value;
  const name = els.name.value;
  if (!assetId) return;
  const ok = confirm(`${assetNo} / ${name}\n이 비품을 삭제할까요? 삭제 후 복구가 어렵습니다.`);
  if (!ok) return;

  try {
    await deleteDoc(doc(db, "assets", assetId));
    await addLog("delete", assetId, assetNo, name);
    els.assetDialog.close();
    removeAssetQueryParam();
    toast("비품이 삭제되었습니다.");
  } catch (error) {
    console.error(error);
    toast("삭제 중 오류가 발생했습니다.");
  }
}

async function addLog(action, assetId, assetNo, name) {
  try {
    await addDoc(collection(db, "assetLogs"), {
      action,
      assetId,
      assetNo,
      name,
      userEmail: currentUser?.email || "unknown",
      at: serverTimestamp()
    });
  } catch (error) {
    console.warn("log failed", error);
  }
}

function listenAssets() {
  if (unsubscribeAssets) unsubscribeAssets();
  setSyncStatus("불러오는 중", "muted");
  unsubscribeAssets = onSnapshot(collection(db, "assets"), (snapshot) => {
    assets = snapshot.docs.map((item) => ({ id: item.id, ...item.data() }));
    renderAll();
    setSyncStatus("실시간 연결됨", "online");
    openAssetFromUrlIfNeeded();
  }, (error) => {
    console.error(error);
    setSyncStatus("연결 오류", "offline");
    toast("Firestore 연결 또는 권한을 확인해주세요.");
  });
}

function stopListeningAssets() {
  if (unsubscribeAssets) unsubscribeAssets();
  unsubscribeAssets = null;
  assets = [];
}

function removeAssetQueryParam() {
  const url = new URL(window.location.href);
  if (url.searchParams.has("asset")) {
    url.searchParams.delete("asset");
    window.history.replaceState({}, "", url.toString());
  }
}

function openAssetFromUrlIfNeeded() {
  const params = new URLSearchParams(window.location.search);
  const assetId = params.get("asset");
  if (!assetId || els.assetDialog.open) return;
  const asset = assets.find((a) => a.id === assetId);
  if (asset) openEditDialog(asset.id);
}

function openQrOnly(assetId) {
  const asset = assets.find((a) => a.id === assetId);
  if (!asset) return;
  fillForm(asset);
  els.assetDialog.showModal();
  toast("오른쪽 QR 이미지를 다운로드하거나 라벨 인쇄를 이용하세요.");
}

function renderPrintLabels() {
  const filtered = getFilteredAssets();
  if (!filtered.length) {
    toast("인쇄할 비품이 없습니다.");
    return;
  }

  els.printSheet.innerHTML = filtered.map((asset) => `
    <article class="qr-label">
      <div class="qr-box" data-qr-id="${asset.id}"></div>
      <div>
        <strong>${escapeHtml(asset.assetNo || "-")}</strong>
        <span>${escapeHtml(asset.name || "-")}</span>
        <span>${escapeHtml(asset.category || "-")} · ${escapeHtml(asset.location || "-")}</span>
        <span>${escapeHtml(asset.status || "-")}</span>
      </div>
    </article>
  `).join("");

  els.printSheet.querySelectorAll("[data-qr-id]").forEach((box) => {
    makeQr(box, getAssetUrl(box.dataset.qrId), 110);
  });

  setTimeout(() => window.print(), 300);
}

function exportCsv() {
  const rows = getFilteredAssets();
  const headers = ["assetNo", "name", "category", "status", "location", "manager", "purchaseDate", "price", "model", "serial", "memo"];
  const csv = [headers.join(",")]
    .concat(rows.map((row) => headers.map((key) => csvEscape(row[key] ?? "")).join(",")))
    .join("\n");

  const blob = new Blob(["\ufeff" + csv], { type: "text/csv;charset=utf-8;" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = `비품관리대장_${new Date().toISOString().slice(0, 10)}.csv`;
  link.click();
  URL.revokeObjectURL(link.href);
}

function csvEscape(value) {
  const text = String(value ?? "");
  if (/[",\n]/.test(text)) return `"${text.replaceAll('"', '""')}"`;
  return text;
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    const next = text[i + 1];

    if (char === '"' && inQuotes && next === '"') {
      cell += '"';
      i += 1;
    } else if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === "," && !inQuotes) {
      row.push(cell);
      cell = "";
    } else if ((char === "\n" || char === "\r") && !inQuotes) {
      if (char === "\r" && next === "\n") i += 1;
      row.push(cell);
      if (row.some((value) => value.trim() !== "")) rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += char;
    }
  }

  row.push(cell);
  if (row.some((value) => value.trim() !== "")) rows.push(row);
  return rows;
}

async function importCsvFile(file) {
  if (!file) return;
  const text = await file.text();
  const rows = parseCsv(text.replace(/^\ufeff/, ""));
  if (rows.length < 2) {
    toast("가져올 데이터가 없습니다.");
    return;
  }

  const headers = rows[0].map((h) => h.trim());
  if (!headers.includes("assetNo") || !headers.includes("name")) {
    toast("CSV 첫 줄에 assetNo, name 헤더가 필요합니다.");
    return;
  }

  const dataRows = rows.slice(1).map((row) => {
    const item = {};
    headers.forEach((header, index) => {
      item[header] = row[index] ?? "";
    });
    item.price = item.price ? Number(item.price) : 0;
    item.status = item.status || "사용중";
    return item;
  }).filter((item) => item.assetNo && item.name);

  if (!dataRows.length) {
    toast("등록 가능한 행이 없습니다.");
    return;
  }

  const ok = confirm(`${dataRows.length}개 비품을 가져옵니다. 같은 비품번호가 있으면 업데이트합니다.`);
  if (!ok) return;

  try {
    const batch = writeBatch(db);
    dataRows.forEach((item) => {
      const existing = assets.find((asset) => asset.assetNo === item.assetNo);
      if (existing) {
        batch.update(doc(db, "assets", existing.id), {
          ...item,
          updatedAt: serverTimestamp(),
          updatedBy: currentUser?.email || "unknown"
        });
      } else {
        const ref = doc(collection(db, "assets"));
        batch.set(ref, {
          ...item,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
          createdBy: currentUser?.email || "unknown",
          updatedBy: currentUser?.email || "unknown"
        });
      }
    });
    await batch.commit();
    await addDoc(collection(db, "assetLogs"), {
      action: "csv-import",
      count: dataRows.length,
      userEmail: currentUser?.email || "unknown",
      at: serverTimestamp()
    });
    toast("CSV 가져오기가 완료되었습니다.");
  } catch (error) {
    console.error(error);
    toast("CSV 가져오기 중 오류가 발생했습니다. 500개 이하로 나누어 시도하세요.");
  } finally {
    els.csvFile.value = "";
  }
}

async function openScanner() {
  if (!window.Html5Qrcode) {
    toast("QR 스캔 라이브러리 로딩 중입니다. 잠시 후 다시 눌러주세요.");
    return;
  }
  els.scanMessage.textContent = "카메라 권한을 허용한 뒤 QR을 비춰주세요.";
  els.scanDialog.showModal();

  try {
    scanner = scanner || new window.Html5Qrcode("reader");
    scannerRunning = true;
    await scanner.start(
      { facingMode: "environment" },
      { fps: 10, qrbox: { width: 250, height: 250 } },
      async (decodedText) => {
        await handleScannedText(decodedText);
      },
      () => {}
    );
  } catch (error) {
    console.error(error);
    els.scanMessage.textContent = "카메라를 열 수 없습니다. HTTPS 접속 또는 브라우저 권한을 확인하세요.";
    scannerRunning = false;
  }
}

async function closeScanner() {
  try {
    if (scanner && scannerRunning) {
      await scanner.stop();
      scanner.clear();
    }
  } catch (error) {
    console.warn(error);
  } finally {
    scannerRunning = false;
    if (els.scanDialog.open) els.scanDialog.close();
  }
}

async function handleScannedText(decodedText) {
  els.scanMessage.textContent = `스캔됨: ${decodedText}`;
  const asset = await findAssetByScannedText(decodedText);
  if (!asset) {
    toast("일치하는 비품을 찾지 못했습니다.");
    return;
  }
  await closeScanner();
  openEditDialog(asset.id);
  toast(`${asset.assetNo} 비품을 열었습니다.`);
}

async function findAssetByScannedText(text) {
  let assetId = "";
  let assetNo = "";

  try {
    const url = new URL(text);
    assetId = url.searchParams.get("asset") || "";
    assetNo = url.searchParams.get("assetNo") || "";
  } catch {
    assetNo = text.trim();
  }

  if (assetId) {
    const local = assets.find((a) => a.id === assetId);
    if (local) return local;
    const snap = await getDoc(doc(db, "assets", assetId));
    return snap.exists() ? { id: snap.id, ...snap.data() } : null;
  }

  if (assetNo) {
    const local = assets.find((a) => a.assetNo === assetNo);
    if (local) return local;
    const q = query(collection(db, "assets"), where("assetNo", "==", assetNo));
    const snap = await getDocs(q);
    if (!snap.empty) {
      const docSnap = snap.docs[0];
      return { id: docSnap.id, ...docSnap.data() };
    }
  }

  return null;
}

function bindEvents() {
  els.loginForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      await signInWithEmailAndPassword(auth, els.loginEmail.value.trim(), els.loginPassword.value);
      toast("로그인되었습니다.");
    } catch (error) {
      console.error(error);
      toast("로그인 실패: 계정 또는 비밀번호를 확인하세요.");
    }
  });

  els.logoutBtn.addEventListener("click", async () => {
    await signOut(auth);
    toast("로그아웃되었습니다.");
  });

  [els.searchInput, els.categoryFilter, els.statusFilter].forEach((el) => {
    el.addEventListener("input", renderTable);
    el.addEventListener("change", renderTable);
  });

  els.resetFiltersBtn.addEventListener("click", () => {
    els.searchInput.value = "";
    els.categoryFilter.value = "";
    els.statusFilter.value = "";
    renderTable();
  });

  els.addBtn.addEventListener("click", openAddDialog);
  els.closeDialogBtn.addEventListener("click", () => els.assetDialog.close());
  els.cancelBtn.addEventListener("click", () => els.assetDialog.close());
  els.assetDialog.addEventListener("close", removeAssetQueryParam);
  els.assetForm.addEventListener("submit", saveAsset);
  els.deleteBtn.addEventListener("click", deleteAsset);
  els.downloadQrBtn.addEventListener("click", () => {
    const filename = els.assetNo.value || "asset-qr";
    downloadQrFrom(els.qrPreview, filename);
  });

  els.tableBody.addEventListener("click", (event) => {
    const button = event.target.closest("button[data-action]");
    if (!button) return;
    if (button.dataset.action === "edit") openEditDialog(button.dataset.id);
    if (button.dataset.action === "qr") openQrOnly(button.dataset.id);
  });

  els.scanBtn.addEventListener("click", openScanner);
  els.closeScanBtn.addEventListener("click", closeScanner);
  els.scanDialog.addEventListener("close", () => {
    if (scannerRunning) closeScanner();
  });

  els.printBtn.addEventListener("click", renderPrintLabels);
  els.exportBtn.addEventListener("click", exportCsv);
  els.importBtn.addEventListener("click", () => els.csvFile.click());
  els.csvFile.addEventListener("change", (event) => importCsvFile(event.target.files[0]));
}

function bindAuth() {
  onAuthStateChanged(auth, (user) => {
    currentUser = user;
    if (user) {
      els.loginPanel.classList.add("hidden");
      els.appPanel.classList.remove("hidden");
      els.logoutBtn.classList.remove("hidden");
      setSyncStatus("로그인됨", "online");
      listenAssets();
    } else {
      stopListeningAssets();
      els.loginPanel.classList.remove("hidden");
      els.appPanel.classList.add("hidden");
      els.logoutBtn.classList.add("hidden");
      setSyncStatus("로그인 필요", "muted");
      els.tableBody.innerHTML = `<tr><td colspan="8" class="empty">로그인 후 비품 목록을 불러옵니다.</td></tr>`;
    }
  });
}

bindEvents();
bindAuth();
