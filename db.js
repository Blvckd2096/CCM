// db.js — Lưu trữ chính bằng IndexedDB. LocalStorage KHÔNG lưu dữ liệu khách.
// Dữ liệu nhà trai / nhà gái là 2 phạm vi riêng (trường side), không bao giờ trộn.
(function () {
  'use strict';
  const DB_NAME = 'cuoi-chung-minh';
  const DB_VERSION = 1;
  let dbPromise = null;

  function openDB() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      if (!('indexedDB' in window)) {
        reject(new Error('Trình duyệt này không hỗ trợ IndexedDB.'));
        return;
      }
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = (e) => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains('guests')) {
          const s = db.createObjectStore('guests', { keyPath: 'id' });
          s.createIndex('side', 'side', { unique: false });
          s.createIndex('groupId', 'groupId', { unique: false });
        }
        if (!db.objectStoreNames.contains('groups')) {
          const s = db.createObjectStore('groups', { keyPath: 'id' });
          s.createIndex('side', 'side', { unique: false });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error || new Error('Không mở được cơ sở dữ liệu.'));
      req.onblocked = () => reject(new Error('Cơ sở dữ liệu đang bị chặn bởi tab khác. Hãy đóng các tab cũ rồi mở lại.'));
    });
    return dbPromise;
  }

  function tx(store, mode, fn) {
    return openDB().then((db) => new Promise((resolve, reject) => {
      const t = db.transaction(store, mode);
      const os = t.objectStore(store);
      let result;
      try { result = fn(os); } catch (err) { reject(err); return; }
      // fn trả về 1 request hoặc 1 promise nội bộ
      const finish = (value) => resolve(value);
      if (result && typeof result.then === 'function') {
        result.then(finish, reject);
      } else if (result && 'onsuccess' in result) {
        result.onsuccess = () => finish(result.result);
        result.onerror = () => reject(result.error);
      } else {
        finish(result);
      }
      t.onerror = () => reject(t.error);
    }));
  }

  function getAll(store) {
    return tx(store, 'readonly', (os) => os.getAll());
  }
  function put(store, value) {
    return tx(store, 'readwrite', (os) => os.put(value));
  }
  function del(store, id) {
    return tx(store, 'readwrite', (os) => os.delete(id));
  }
  function clear(store) {
    return tx(store, 'readwrite', (os) => os.clear());
  }

  function uid() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    return 'id-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
  }

  function nowISO() { return new Date().toISOString(); }

  // Chuẩn hóa tiền: chỉ giữ số nguyên VNĐ, null = chưa nhập (KHÁC 0).
  // Chấp nhận "500.000", "500,000", "500000", "500k" không? — chỉ chấp nhận số + dấu . , và khoảng trắng.
  function parseAmount(raw) {
    if (raw === null || raw === undefined) return null;
    const s = String(raw).trim();
    if (s === '') return null;
    // Bỏ ký tự tiền tệ, khoảng trắng; dấu . và , đều coi là phân tách nghìn khi nhập VN.
    const cleaned = s.replace(/[₫đ\s]/gi, '').replace(/[.,]/g, '');
    if (!/^\d+$/.test(cleaned)) return NaN;
    const n = Number(cleaned);
    if (!Number.isSafeInteger(n) || n < 0) return NaN;
    return n;
  }
  function formatAmount(n) {
    if (n === null || n === undefined) return '';
    return new Intl.NumberFormat('vi-VN').format(n);
  }
  function formatCompact(n) {
    if (!n) return '0';
    if (n >= 1000000) {
      const v = n / 1000000;
      return (Number.isInteger(v) ? String(v) : v.toFixed(1).replace('.', ',')) + ' triệu';
    }
    if (n >= 1000) {
      const v = n / 1000;
      return (Number.isInteger(v) ? String(v) : v.toFixed(1).replace('.', ',')) + ' nghìn';
    }
    return String(n);
  }

  const DEFAULT_GROUPS = ['Gia đình', 'Họ hàng', 'Bạn cấp 2', 'Bạn cấp 3', 'Bạn đại học', 'Bạn bè', 'Đồng nghiệp', 'Hàng xóm', 'Khác'];

  function validateGuest(g) {
    if (!g || typeof g !== 'object') return 'Dữ liệu khách không hợp lệ.';
    if (!g.name || !String(g.name).trim()) return 'Tên khách mời là bắt buộc.';
    if (g.side !== 'trai' && g.side !== 'gai') return 'Bên gia đình không hợp lệ.';
    if (g.amount !== null && g.amount !== undefined && (!Number.isInteger(g.amount) || g.amount < 0)) return 'Số tiền mừng không hợp lệ.';
    if (g.returned !== 'cho' && g.returned !== 'da' && g.returned !== 'thang') return 'Trạng thái mừng không hợp lệ.';
    if (g.peopleCount !== null && g.peopleCount !== undefined && (!Number.isInteger(g.peopleCount) || g.peopleCount < 1 || g.peopleCount > 99)) return 'Số lượng người không hợp lệ.';
    return null;
  }

  // Seed nhóm mặc định cho 1 bên nếu bên đó chưa có nhóm nào.
  function ensureDefaultGroups(side) {
    return getAll('groups').then((all) => {
      const mine = all.filter((g) => g.side === side);
      if (mine.length) return mine;
      const created = DEFAULT_GROUPS.map((name, i) => ({ id: uid(), side, name, order: i, createdAt: nowISO() }));
      return Promise.all(created.map((g) => put('groups', g))).then(() => created);
    });
  }

  window.CuoiDB = {
    openDB, getAll, put, del, clear, uid, nowISO,
    parseAmount, formatAmount, formatCompact, validateGuest, ensureDefaultGroups,
    DEFAULT_GROUPS,
    getAllGuests: () => getAll('guests'),
    getAllGroups: () => getAll('groups'),
    saveGuest: (g) => { const e = validateGuest(g); if (e) return Promise.reject(new Error(e)); return put('guests', g); },
    saveGroup: (g) => put('groups', g),
    deleteGuest: (id) => del('guests', id),
    deleteGroup: (id) => del('groups', id),
  };
})();
