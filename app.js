// app.js — Nghiệp vụ: 2 bên riêng biệt, tiền null ≠ 0, thống kê tính lại sau mỗi thay đổi.
(function () {
  'use strict';
  const DB = window.CuoiDB;
  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));

  let side = 'trai';
  let savedScroll = 0;
  let filters = { search: '', group: '', invited: '', returned: '' };
  try {
    const savedSide = localStorage.getItem('cuoi_last_side');
    if (savedSide === 'trai' || savedSide === 'gai') side = savedSide;
    const savedFilters = JSON.parse(localStorage.getItem('cuoi_last_filters') || 'null');
    if (savedFilters && typeof savedFilters === 'object') {
      filters.search = typeof savedFilters.search === 'string' ? savedFilters.search : '';
      filters.group = typeof savedFilters.group === 'string' ? savedFilters.group : '';
      filters.invited = savedFilters.invited === 'da' || savedFilters.invited === 'chua' ? savedFilters.invited : '';
      filters.returned = savedFilters.returned === 'da' || savedFilters.returned === 'cho' ? savedFilters.returned : '';
    }
    savedScroll = Number(localStorage.getItem('cuoi_last_scroll') || 0) || 0;
  } catch (e) {}
  let guests = [];
  let groups = [];
  let editingGuest = null; // {id|null, invited, returned}
  let editingGroup = null;
  let pendingImport = null;
  let confirmCallback = null;
  let saving = false;

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }
  function toast(msg) {
    const t = $('#toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(t._timer);
    t._timer = setTimeout(() => t.classList.remove('show'), 2600);
  }
  function openOverlay(id) { $(id).classList.add('open'); }
  function closeOverlay(id) { $(id).classList.remove('open'); }
  function closeAll() { $$('.overlay').forEach((o) => o.classList.remove('open')); }

  function sideName(s) { return s === 'trai' ? 'Nhà trai' : 'Nhà gái'; }
  function groupsFor(s) { return groups.filter((g) => g.side === s).sort((a, b) => a.order - b.order); }
  function guestsFor(s) { return guests.filter((g) => g.side === s); }
  function groupName(id) {
    const g = groups.find((x) => x.id === id);
    return g ? g.name : 'Khác';
  }

  function calcStats(list) {
    const total = list.length;
    const invited = list.filter((g) => g.invited).length;
    const withMoneyList = list.filter((g) => g.amount !== null && g.amount !== undefined);
    const totalMoney = withMoneyList.reduce((sum, g) => sum + g.amount, 0);
    return {
      total, invited, notInvited: total - invited, totalMoney,
      withMoney: withMoneyList.length, noMoney: total - withMoneyList.length,
      waiting: list.filter((g) => g.returned === 'cho').length,
      returned: list.filter((g) => g.returned === 'da').length,
    };
  }

  function renderStats() {
    const mine = guestsFor(side);
    const st = calcStats(mine);
    const trai = calcStats(guestsFor('trai'));
    const gai = calcStats(guestsFor('gai'));
    $('#statSideLabel').textContent = sideName(side);
    $('#statTotalMoney').textContent = DB.formatAmount(st.totalMoney) + ' VNĐ';
    $('#statTotalMoneyCompact').textContent = 'Tổng tiền mừng đã nhập • ' + DB.formatCompact(st.totalMoney);
    $('#statTotalGuests').textContent = st.total;
    $('#statInvited').textContent = st.invited;
    $('#statNotInvited').textContent = st.notInvited;
    $('#statWithMoney').textContent = st.withMoney;
    $('#statWaiting').textContent = st.waiting;
    $('#statReturned').textContent = st.returned;
    $('#statNoMoney').textContent = st.noMoney;
    $('#tabTraiSub').textContent = trai.total + ' khách';
    $('#tabGaiSub').textContent = gai.total + ' khách';
    $('#combinedTrai').textContent = DB.formatAmount(trai.totalMoney) + ' VNĐ';
    $('#combinedGai').textContent = DB.formatAmount(gai.totalMoney) + ' VNĐ';
    $('#combinedAll').textContent = DB.formatAmount(trai.totalMoney + gai.totalMoney) + ' VNĐ';
    $$('.tab').forEach((t) => {
      const active = t.dataset.tab === side;
      t.classList.toggle('active', active);
      t.setAttribute('aria-selected', active ? 'true' : 'false');
    });
    document.body.dataset.side = side;
  }

  function renderGroupFilter() {
    const sel = $('#filterGroup');
    const prev = filters.group;
    sel.innerHTML = '<option value="">Tất cả các nhóm</option>' + groupsFor(side).map((g) =>
      '<option value="' + esc(g.id) + '"' + (g.id === prev ? ' selected' : '') + '>' + esc(g.name) + '</option>').join('');
  }

  function filteredGuests(groupId) {
    let list = guests.filter((g) => g.side === side && g.groupId === groupId);
    if (filters.group && filters.group !== groupId) return [];
    if (filters.search) {
      const q = filters.search.toLowerCase();
      list = list.filter((g) => g.name.toLowerCase().includes(q) || (g.note || '').toLowerCase().includes(q));
    }
    if (filters.invited === 'da') list = list.filter((g) => g.invited);
    if (filters.invited === 'chua') list = list.filter((g) => !g.invited);
    if (filters.returned) list = list.filter((g) => g.returned === filters.returned);
    // Danh sách khách luôn xếp theo tên A → Z (tiếng Việt), không xếp theo thời gian sửa nữa.
    return list.sort((a, b) => a.name.localeCompare(b.name, 'vi', { sensitivity: 'base' }));
  }

  function guestCardHTML(g) {
    const moneyVal = g.amount === null || g.amount === undefined ? '' : DB.formatAmount(g.amount);
    const notePreview = (g.note || '').trim();
    const shortNote = notePreview.length > 90 ? notePreview.slice(0, 90) + '…' : notePreview;
    return '' +
    '<article class="guest" data-guest-id="' + esc(g.id) + '">' +
      '<div class="guest-top">' +
        '<div style="min-width:0"><div class="guest-name"><button type="button" data-edit="' + esc(g.id) + '">' + esc(g.name) + '</button></div>' +
        '<div class="guest-sub">' + esc(groupName(g.groupId)) + (g.amount === null ? ' • Chưa nhập tiền' : ' • ' + DB.formatAmount(g.amount) + ' VNĐ') + '</div></div>' +
        '<button type="button" class="pill ' + (g.invited ? 'invited' : 'notinvited') + '" data-toggle-invite="' + esc(g.id) + '">' + (g.invited ? 'Đã mời' : 'Chưa mời') + '</button>' +
      '</div>' +
      '<div class="guest-middle">' +
        '<div class="money-wrap"><input type="text" inputmode="decimal" data-money="' + esc(g.id) + '" value="' + esc(moneyVal) + '" placeholder="Tiền mừng" aria-label="Tiền mừng của ' + esc(g.name) + '"><span>VNĐ</span></div>' +
        '<button type="button" class="pill ' + (g.returned === 'da' ? 'returned' : 'waiting') + '" data-toggle-returned="' + esc(g.id) + '">' + (g.returned === 'da' ? 'Đã mừng lại' : 'Chờ mừng lại') + '</button>' +
      '</div>' +
      (shortNote ? '<div class="note-preview">' + esc(shortNote) + '</div>' : '') +
      '<div class="guest-actions"><button type="button" class="text-btn" data-expand="' + esc(g.id) + '">Chi tiết ▾</button>' +
      '<button type="button" class="text-btn" data-edit="' + esc(g.id) + '">Sửa</button>' +
      '<button type="button" class="text-btn danger" data-delete="' + esc(g.id) + '">Xóa</button></div>' +
      '<div class="guest-detail" data-detail="' + esc(g.id) + '">' +
        '<label>Nhập nhanh</label><div class="quick-row">' +
          '<button type="button" data-quick="' + esc(g.id) + '" data-amount="200000">200K</button>' +
          '<button type="button" data-quick="' + esc(g.id) + '" data-amount="300000">300K</button>' +
          '<button type="button" data-quick="' + esc(g.id) + '" data-amount="500000">500K</button>' +
          '<button type="button" data-quick="' + esc(g.id) + '" data-amount="1000000">1M</button>' +
        '</div>' +
        '<label>Chuyển nhóm</label><select data-move="' + esc(g.id) + '">' + groupsFor(side).map((gr) =>
          '<option value="' + esc(gr.id) + '"' + (gr.id === g.groupId ? ' selected' : '') + '>' + esc(gr.name) + '</option>').join('') + '</select>' +
        '<label>Ghi chú</label><textarea data-note="' + esc(g.id) + '" maxlength="1000" placeholder="Ví dụ: Đã gửi thiệp, cần gọi xác nhận…">' + esc(g.note || '') + '</textarea>' +
        '<p class="muted small" style="margin:6px 0 0">Ghi chú lưu tự động khi bạn rời khỏi ô nhập.</p>' +
      '</div>' +
    '</article>';
  }

  function renderList() {
    const wrap = $('#guestList');
    const myGroups = groupsFor(side);
    let html = '';
    let totalShown = 0;
    myGroups.forEach((gr, idx) => {
      const list = filteredGuests(gr.id);
      // Khi đang lọc/tìm, ẩn nhóm không có khách phù hợp.
      const filtering = filters.search || filters.group || filters.invited || filters.returned;
      if (filtering && list.length === 0) return;
      totalShown += list.length;
      const allInGroup = guests.filter((g) => g.side === side && g.groupId === gr.id);
      const invitedInGroup = allInGroup.filter((g) => g.invited).length;
      html += '<section class="group"><div class="group-head"><div><h3>' + esc(gr.name) + '</h3>' +
        '<div class="count">' + invitedInGroup + '/' + allInGroup.length + ' đã mời</div></div>' +
        '<div class="group-actions">' +
          '<button type="button" class="mini-btn" data-group-up="' + esc(gr.id) + '" aria-label="Đưa nhóm lên trên" ' + (idx === 0 ? 'disabled' : '') + '>↑</button>' +
          '<button type="button" class="mini-btn" data-group-down="' + esc(gr.id) + '" aria-label="Đưa nhóm xuống dưới" ' + (idx === myGroups.length - 1 ? 'disabled' : '') + '>↓</button>' +
          '<button type="button" class="mini-btn" data-group-rename="' + esc(gr.id) + '">Đổi tên</button>' +
          '<button type="button" class="mini-btn" data-group-delete="' + esc(gr.id) + '">Xóa</button>' +
        '</div></div>';
      if (list.length === 0) html += '<p class="muted small" style="padding:0 2px">Chưa có khách trong nhóm này.</p>';
      else html += list.map(guestCardHTML).join('');
      html += '</section>';
    });
    wrap.innerHTML = html;
    $('#emptyState').hidden = !(myGroups.length === 0 || (totalShown === 0 && !filters.search && !filters.group && !filters.invited && !filters.returned && guestsFor(side).length === 0));
    if (totalShown === 0 && guestsFor(side).length > 0) {
      wrap.innerHTML = '<div class="card empty"><b>Không tìm thấy khách phù hợp</b><span>Thử đổi từ khóa hoặc bộ lọc.</span></div>';
    }
  }

  function renderAll() { renderStats(); renderGroupFilter(); renderList(); }

  function refreshStatsAndTabs() { renderStats(); }

  // ---------- Lưu khách ----------
  function saveGuestRecord(g, silent) {
    const err = DB.validateGuest(g);
    if (err) { toast(err); return Promise.reject(new Error(err)); }
    g.updatedAt = DB.nowISO();
    return DB.saveGuest(g).then(() => {
      const i = guests.findIndex((x) => x.id === g.id);
      if (i >= 0) guests[i] = g; else guests.push(g);
      renderStats();
      if (!silent) toast('Đã lưu khách mời.');
    }).catch((e) => { toast('Lỗi lưu dữ liệu: ' + e.message); throw e; });
  }

  function toggleInvite(id) {
    const g = guests.find((x) => x.id === id);
    if (!g) return;
    g.invited = !g.invited;
    // Cập nhật nút tại chỗ, không render lại toàn danh sách (giữ vị trí cuộn).
    const btn = document.querySelector('[data-toggle-invite="' + CSS.escape(id) + '"]');
    if (btn) {
      btn.textContent = g.invited ? 'Đã mời' : 'Chưa mời';
      btn.className = 'pill ' + (g.invited ? 'invited' : 'notinvited');
    }
    saveGuestRecord(g, true).then(() => renderList()).catch(() => renderAll());
  }
  function toggleReturned(id) {
    const g = guests.find((x) => x.id === id);
    if (!g) return;
    g.returned = g.returned === 'da' ? 'cho' : 'da';
    const btn = document.querySelector('[data-toggle-returned="' + CSS.escape(id) + '"]');
    if (btn) {
      btn.textContent = g.returned === 'da' ? 'Đã mừng lại' : 'Chờ mừng lại';
      btn.className = 'pill ' + (g.returned === 'da' ? 'returned' : 'waiting');
    }
    saveGuestRecord(g, true).then(() => renderStats()).catch(() => renderAll());
  }

  function saveMoneyFromInput(input) {
    const id = input.dataset.money;
    const g = guests.find((x) => x.id === id);
    if (!g) return;
    const parsed = DB.parseAmount(input.value);
    if (Number.isNaN(parsed)) {
      toast('Số tiền không hợp lệ. Chỉ nhập số.');
      input.value = g.amount === null || g.amount === undefined ? '' : DB.formatAmount(g.amount);
      return;
    }
    if (parsed === g.amount) {
      input.value = parsed === null ? '' : DB.formatAmount(parsed);
      return;
    }
    g.amount = parsed;
    saveGuestRecord(g, true).then(() => {
      input.value = parsed === null ? '' : DB.formatAmount(parsed);
      renderList();
    });
  }

  // Nhóm mặc định cho lần thêm sau = nhóm của lần nhập trước, lưu riêng từng bên.
  function getLastGroupId(s) {
    try { return localStorage.getItem('cuoi_last_group_' + s) || ''; } catch (e) { return ''; }
  }
  function setLastGroupId(s, groupId) {
    try { if (groupId) localStorage.setItem('cuoi_last_group_' + s, groupId); } catch (e) {}
  }

  // ---------- Form khách ----------
  function openGuestForm(guest) {
    editingGuest = guest
      ? { id: guest.id, invited: guest.invited, returned: guest.returned }
      : { id: null, invited: false, returned: 'cho' };
    $('#guestModalTitle').textContent = guest ? 'Sửa khách mời' : 'Thêm khách mời';
    $('#fName').value = guest ? guest.name : '';
    const sel = $('#fGroup');
    const myGroups = groupsFor(side);
    // Sửa thì giữ nhóm của khách đó; thêm mới thì lấy nhóm lần nhập trước, nếu nhóm đó không còn thì về nhóm đầu tiên.
    let defaultGroupId = guest ? guest.groupId : getLastGroupId(side);
    if (!myGroups.find((gr) => gr.id === defaultGroupId)) defaultGroupId = myGroups[0] ? myGroups[0].id : '';
    sel.innerHTML = myGroups.map((gr) => '<option value="' + esc(gr.id) + '"' + (gr.id === defaultGroupId ? ' selected' : '') + '>' + esc(gr.name) + '</option>').join('');
    $('#fAmount').value = guest && guest.amount !== null && guest.amount !== undefined ? DB.formatAmount(guest.amount) : '';
    $('#fNote').value = guest ? (guest.note || '') : '';
    $('#guestFormError').hidden = true;
    updateGuestSegments();
    openOverlay('#guestModal');
    setTimeout(() => $('#fName').focus(), 60);
  }
  function updateGuestSegments() {
    $('#segInvited').classList.toggle('active', !!editingGuest.invited);
    $('#segNotInvited').classList.toggle('active', !editingGuest.invited);
    $('#segReturned').classList.toggle('active', editingGuest.returned === 'da');
    $('#segWaiting').classList.toggle('active', editingGuest.returned === 'cho');
  }

  // ---------- Xác nhận ----------
  function askConfirm(title, text, okLabel, extraHTML, cb) {
    $('#confirmTitle').textContent = title;
    $('#confirmText').textContent = text;
    $('#confirmExtra').innerHTML = extraHTML || '';
    $('#btnConfirmOk').textContent = okLabel || 'Xác nhận xóa';
    confirmCallback = cb;
    openOverlay('#confirmModal');
  }

  // Khách có groupId không còn tồn tại (ví dụ file sao lưu cũ) thì đưa về nhóm Khác, không để mất khỏi danh sách.
  function normalizeOrphans() {
    const ops = [];
    ['trai', 'gai'].forEach((s) => {
      let other = groups.find((g) => g.side === s && g.name === 'Khác');
      guests.forEach((g) => {
        if (g.side !== s) return;
        if (!groups.find((gr) => gr.id === g.groupId)) {
          if (!other) {
            const maxOrder = groupsFor(s).reduce((m, x) => Math.max(m, x.order), -1);
            other = { id: DB.uid(), side: s, name: 'Khác', order: maxOrder + 1, createdAt: DB.nowISO() };
            groups.push(other); ops.push(DB.saveGroup(other));
          }
          g.groupId = other.id; g.updatedAt = DB.nowISO(); ops.push(DB.saveGuest(g));
        }
      });
    });
    return Promise.all(ops);
  }

  // Lưu chỗ đang xem: tab + bộ lọc + vị trí cuộn, để lần vào sau trở lại đúng chỗ cũ.
  function saveView() {
    try {
      localStorage.setItem('cuoi_last_side', side);
      localStorage.setItem('cuoi_last_filters', JSON.stringify(filters));
      localStorage.setItem('cuoi_last_scroll', String(Math.round(window.scrollY || 0)));
    } catch (e) {}
  }
  let scrollTimer = null;
  window.addEventListener('scroll', () => {
    clearTimeout(scrollTimer);
    scrollTimer = setTimeout(saveView, 300);
  }, { passive: true });
  document.addEventListener('visibilitychange', () => { if (document.hidden) saveView(); });
  window.addEventListener('pagehide', saveView);

  // ---------- Khởi tạo ----------
  function load() {
    return DB.ensureDefaultGroups('trai')
      .then(() => DB.ensureDefaultGroups('gai'))
      .then(() => Promise.all([DB.getAllGuests(), DB.getAllGroups()]))
      .then(([gs, grs]) => { guests = gs || []; groups = grs || []; return normalizeOrphans(); })
      .then(() => {
        renderAll();
        // Khôi phục bộ lọc đã lưu vào ô nhập, rồi trở lại vị trí cuộn lần trước.
        try {
          $('#searchInput').value = filters.search;
          $('#filterInvited').value = filters.invited;
          $('#filterReturned').value = filters.returned;
          $$('[data-invite-filter]').forEach((b) => b.classList.toggle('active', b.dataset.inviteFilter === filters.invited));
          // Nhóm đã lưu có thể không còn thuộc bên này thì bỏ lọc nhóm, tránh danh sách trống oan.
          if (filters.group && !groupsFor(side).find((g) => g.id === filters.group)) { filters.group = ''; renderGroupFilter(); }
        } catch (e) {}
        renderList();
        if (savedScroll > 0) {
          requestAnimationFrame(() => requestAnimationFrame(() => window.scrollTo(0, savedScroll)));
        }
      })
      .catch((e) => { toast('Không đọc được dữ liệu: ' + e.message); });
  }

  // ---------- Sự kiện ----------
  document.addEventListener('click', (e) => {
    const t = e.target.closest('button');
    if (!t) return;
    const id = (attr) => t.dataset[attr];
    if (t.dataset.tab) {
      side = t.dataset.tab;
      filters.group = '';
      $('#filterGroup').value = '';
      renderAll();
      window.scrollTo(0, 0);
      saveView();
      return;
    }
    if (t.dataset.inviteFilter !== undefined) {
      filters.invited = t.dataset.inviteFilter;
      $('#filterInvited').value = filters.invited;
      $$('[data-invite-filter]').forEach((b) => b.classList.toggle('active', b.dataset.inviteFilter === filters.invited));
      renderList(); saveView();
      return;
    }
    if (id('toggleInvite')) { toggleInvite(id('toggleInvite')); return; }
    if (id('toggleReturned')) { toggleReturned(id('toggleReturned')); return; }
    if (id('expand')) {
      const detail = document.querySelector('[data-detail="' + CSS.escape(id('expand')) + '"]');
      if (detail) {
        const open = detail.classList.toggle('open');
        t.textContent = open ? 'Thu gọn ▴' : 'Chi tiết ▾';
      }
      return;
    }
    if (id('edit')) { const g = guests.find((x) => x.id === id('edit')); if (g) openGuestForm(g); return; }
    if (id('delete')) {
      const g = guests.find((x) => x.id === id('delete'));
      if (!g) return;
      askConfirm('Xóa khách mời?', 'Bạn có chắc muốn xóa “' + g.name + '” không? Hành động này không thể hoàn tác.', 'Xóa khách', '', () => {
        DB.deleteGuest(g.id).then(() => {
          guests = guests.filter((x) => x.id !== g.id);
          renderAll(); toast('Đã xóa khách mời.');
        }).catch((err) => toast('Lỗi xóa: ' + err.message));
      });
      return;
    }
    if (id('quick')) {
      const g = guests.find((x) => x.id === id('quick'));
      if (!g) return;
      g.amount = Number(t.dataset.amount);
      saveGuestRecord(g, true).then(() => renderList());
      return;
    }
    if (id('groupUp') || id('groupDown')) {
      const gid = id('groupUp') || id('groupDown');
      const list = groupsFor(side);
      const idx = list.findIndex((x) => x.id === gid);
      const swapIdx = id('groupUp') ? idx - 1 : idx + 1;
      if (idx < 0 || swapIdx < 0 || swapIdx >= list.length) return;
      const a = list[idx], b = list[swapIdx];
      const tmp = a.order; a.order = b.order; b.order = tmp;
      Promise.all([DB.saveGroup(a), DB.saveGroup(b)]).then(renderAll);
      return;
    }
    if (id('groupRename')) {
      const gr = groups.find((x) => x.id === id('groupRename'));
      if (!gr) return;
      editingGroup = gr;
      $('#groupModalTitle').textContent = 'Đổi tên nhóm';
      $('#gName').value = gr.name;
      openOverlay('#groupModal');
      setTimeout(() => $('#gName').focus(), 60);
      return;
    }
    if (id('groupDelete')) {
      const gr = groups.find((x) => x.id === id('groupDelete'));
      if (!gr) return;
      const inGroup = guests.filter((x) => x.side === side && x.groupId === gr.id);
      const others = groupsFor(side).filter((x) => x.id !== gr.id);
      if (inGroup.length === 0) {
        askConfirm('Xóa nhóm?', 'Xóa nhóm “' + gr.name + '” không? Nhóm này đang trống.', 'Xóa nhóm', '', () => {
          DB.deleteGroup(gr.id).then(() => { groups = groups.filter((x) => x.id !== gr.id); renderAll(); toast('Đã xóa nhóm.'); });
        });
      } else if (others.length === 0) {
        toast('Không thể xóa nhóm cuối cùng khi vẫn còn khách. Hãy chuyển khách sang nhóm mới trước.');
      } else {
        const opts = others.map((o) => '<option value="' + esc(o.id) + '">' + esc(o.name) + '</option>').join('');
        askConfirm('Xóa nhóm có khách?', 'Nhóm “' + gr.name + '” đang có ' + inGroup.length + ' khách. Chọn nhóm để chuyển toàn bộ khách sang trước khi xóa:', 'Chuyển khách và xóa nhóm',
          '<label style="display:block;font-size:14px;font-weight:600;margin:10px 0 5px">Chuyển sang nhóm</label><select id="deleteGroupTarget" style="width:100%;min-height:46px;border:1px solid #e5e0da;border-radius:11px;padding:10px">' + opts + '</select>', () => {
            const target = $('#deleteGroupTarget').value;
            const moves = inGroup.map((g) => { g.groupId = target; g.updatedAt = DB.nowISO(); return DB.saveGuest(g); });
            Promise.all(moves).then(() => DB.deleteGroup(gr.id)).then(() => load()).then(() => toast('Đã chuyển khách và xóa nhóm.'));
          });
      }
      return;
    }
  });

  document.addEventListener('change', (e) => {
    const el = e.target;
    if (el.dataset && el.dataset.money) { saveMoneyFromInput(el); return; }
    if (el.dataset && el.dataset.note) {
      const g = guests.find((x) => x.id === el.dataset.note);
      if (g) { g.note = el.value; saveGuestRecord(g, true).then(renderList); }
      return;
    }
    if (el.dataset && el.dataset.move) {
      const g = guests.find((x) => x.id === el.dataset.move);
      if (g) { g.groupId = el.value; saveGuestRecord(g, true).then(renderAll).then(() => toast('Đã chuyển nhóm.')); }
      return;
    }
  });

  // Định dạng lại tiền khi rời ô nhập ở form (không làm phiền lúc đang gõ).
  $('#fAmount').addEventListener('blur', (e) => {
    const p = DB.parseAmount(e.target.value);
    if (!Number.isNaN(p) && p !== null) e.target.value = DB.formatAmount(p);
  });

  $('#searchInput').addEventListener('input', (e) => { filters.search = e.target.value.trim(); renderList(); saveView(); });
  $('#filterGroup').addEventListener('change', (e) => { filters.group = e.target.value; renderList(); saveView(); });
  $('#filterInvited').addEventListener('change', (e) => {
    filters.invited = e.target.value;
    $$('[data-invite-filter]').forEach((b) => b.classList.toggle('active', b.dataset.inviteFilter === filters.invited));
    renderList(); saveView();
  });
  $('#filterReturned').addEventListener('change', (e) => { filters.returned = e.target.value; renderList(); saveView(); });

  $('#btnAddGuest').addEventListener('click', () => openGuestForm(null));
  $('#btnCancelGuest').addEventListener('click', closeAll);
  $('#segInvited').addEventListener('click', () => { editingGuest.invited = true; updateGuestSegments(); });
  $('#segNotInvited').addEventListener('click', () => { editingGuest.invited = false; updateGuestSegments(); });
  $('#segReturned').addEventListener('click', () => { editingGuest.returned = 'da'; updateGuestSegments(); });
  $('#segWaiting').addEventListener('click', () => { editingGuest.returned = 'cho'; updateGuestSegments(); });
  $$('#guestForm .quick-row button').forEach((b) => b.addEventListener('click', () => {
    $('#fAmount').value = DB.formatAmount(Number(b.dataset.quick));
  }));

  $('#guestForm').addEventListener('submit', (e) => {
    e.preventDefault();
    if (saving) return;
    const name = $('#fName').value.trim();
    if (!name) { const err = $('#guestFormError'); err.textContent = 'Tên khách mời là bắt buộc.'; err.hidden = false; $('#fName').focus(); return; }
    const amount = DB.parseAmount($('#fAmount').value);
    if (Number.isNaN(amount)) { const err = $('#guestFormError'); err.textContent = 'Số tiền không hợp lệ. Chỉ nhập số.'; err.hidden = false; return; }
    const groupId = $('#fGroup').value || (groupsFor(side)[0] && groupsFor(side)[0].id);
    if (!groupId) { toast('Chưa có nhóm nào. Hãy thêm nhóm trước.'); return; }
    saving = true;
    $('#btnSaveGuest').disabled = true;
    const rec = editingGuest.id
      ? Object.assign({}, guests.find((x) => x.id === editingGuest.id), { name, groupId, invited: editingGuest.invited, amount, returned: editingGuest.returned, note: $('#fNote').value })
      : { id: DB.uid(), side, name, groupId, invited: editingGuest.invited, amount, returned: editingGuest.returned, note: $('#fNote').value, createdAt: DB.nowISO(), updatedAt: DB.nowISO() };
    saveGuestRecord(rec, true).then(() => {
      saving = false; $('#btnSaveGuest').disabled = false;
      // Chỉ lưu nhóm khi đã lưu thành công; bấm Hủy thì không đổi nhóm mặc định.
      setLastGroupId(side, groupId);
      closeAll(); renderAll(); toast(editingGuest.id ? 'Đã cập nhật khách mời.' : 'Đã thêm khách mời.');
    }).catch(() => { saving = false; $('#btnSaveGuest').disabled = false; });
  });

  $('#btnAddGroup').addEventListener('click', () => {
    editingGroup = null;
    $('#groupModalTitle').textContent = 'Thêm nhóm mới';
    $('#gName').value = '';
    openOverlay('#groupModal');
    setTimeout(() => $('#gName').focus(), 60);
  });
  $('#btnCancelGroup').addEventListener('click', closeAll);
  $('#groupForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const name = $('#gName').value.trim();
    if (!name) { toast('Tên nhóm là bắt buộc.'); return; }
    if (editingGroup) {
      editingGroup.name = name;
      DB.saveGroup(editingGroup).then(() => { closeAll(); renderAll(); toast('Đã đổi tên nhóm.'); });
    } else {
      const maxOrder = groupsFor(side).reduce((m, g) => Math.max(m, g.order), -1);
      const gr = { id: DB.uid(), side, name, order: maxOrder + 1, createdAt: DB.nowISO() };
      DB.saveGroup(gr).then(() => { groups.push(gr); closeAll(); renderAll(); toast('Đã thêm nhóm mới.'); });
    }
  });

  $('#btnConfirmCancel').addEventListener('click', () => { confirmCallback = null; closeAll(); });
  $('#btnConfirmOk').addEventListener('click', () => { const cb = confirmCallback; confirmCallback = null; closeAll(); if (cb) cb(); });

  $$('.overlay').forEach((o) => o.addEventListener('click', (e) => { if (e.target === o) closeAll(); }));

  $('#btnToggleCombined').addEventListener('click', () => {
    const box = $('#combinedBox');
    box.hidden = !box.hidden;
    $('#btnToggleCombined').textContent = box.hidden ? 'Xem tổng hợp 2 bên ▾' : 'Ẩn tổng hợp 2 bên ▴';
  });

  // Cài đặt / sao lưu
  $('#btnSettings').addEventListener('click', () => openOverlay('#settingsModal'));
  $('#btnCloseSettings').addEventListener('click', closeAll);
  $('#btnExport').addEventListener('click', () => {
    const data = { app: 'cuoi-chung-minh', version: 1, exportedAt: new Date().toISOString(), groups, guests };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'cuoi-chung-minh-sao-luu-' + new Date().toISOString().slice(0, 10) + '.json';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    toast('Đã xuất file sao lưu.');
  });
  $('#btnImport').addEventListener('click', () => $('#importFile').click());
  $('#importFile').addEventListener('change', (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const data = JSON.parse(reader.result);
        if (!data || !Array.isArray(data.guests) || !Array.isArray(data.groups)) throw new Error('File không đúng định dạng sao lưu của Cưới chúng mình.');
        const bad = data.guests.find((g) => !g.name || !String(g.name).trim() || (g.side !== 'trai' && g.side !== 'gai') || (g.amount !== null && g.amount !== undefined && (!Number.isInteger(g.amount) || g.amount < 0)));
        if (bad) throw new Error('File có khách mời không hợp lệ (thiếu tên, sai bên hoặc sai tiền).');
        pendingImport = data;
        $('#importSummary').textContent = 'File có ' + data.groups.length + ' nhóm và ' + data.guests.length + ' khách. Bạn muốn gộp hay thay thế?';
        closeAll(); openOverlay('#importModal');
      } catch (err) { toast('Không nhập được file: ' + err.message); }
    };
    reader.onerror = () => toast('Không đọc được file đã chọn.');
    reader.readAsText(file);
  });
  $('#btnImportCancel').addEventListener('click', () => { pendingImport = null; closeAll(); });
  $('#btnImportMerge').addEventListener('click', () => {
    if (!pendingImport) return;
    const ops = [];
    pendingImport.groups.forEach((gr) => { if (gr.id && gr.name) ops.push(DB.saveGroup(gr)); });
    pendingImport.guests.forEach((g) => {
      const rec = {
        id: g.id || DB.uid(), side: g.side, name: String(g.name).trim(),
        groupId: g.groupId || '', invited: !!g.invited,
        amount: (g.amount === null || g.amount === undefined) ? null : g.amount,
        returned: g.returned === 'da' ? 'da' : 'cho', note: g.note || '',
        createdAt: g.createdAt || DB.nowISO(), updatedAt: DB.nowISO(),
      };
      ops.push(DB.saveGuest(rec));
    });
    Promise.all(ops).then(() => load()).then(() => { pendingImport = null; closeAll(); toast('Đã gộp dữ liệu từ file sao lưu.'); });
  });
  $('#btnImportReplace').addEventListener('click', () => {
    if (!pendingImport) return;
    askConfirm('Thay thế toàn bộ dữ liệu?', 'Toàn bộ khách và nhóm hiện tại sẽ bị xóa trước khi nhập file này. Bạn có chắc không?', 'Thay thế toàn bộ',
      '', () => {
        Promise.all([DB.clear('guests'), DB.clear('groups')]).then(() => {
          const ops = [];
          pendingImport.groups.forEach((gr) => ops.push(DB.saveGroup(gr)));
          pendingImport.guests.forEach((g) => ops.push(DB.saveGuest({
            id: g.id || DB.uid(), side: g.side, name: String(g.name).trim(), groupId: g.groupId || '',
            invited: !!g.invited, amount: (g.amount === null || g.amount === undefined) ? null : g.amount,
            returned: g.returned === 'da' ? 'da' : 'cho', note: g.note || '',
            createdAt: g.createdAt || DB.nowISO(), updatedAt: DB.nowISO(),
          })));
          return Promise.all(ops);
        }).then(() => load()).then(() => { pendingImport = null; closeAll(); toast('Đã khôi phục dữ liệu từ file sao lưu.'); });
      });
  });

  // Trạng thái ban đầu: về đúng tab gần nhất đã lưu.
  document.body.dataset.side = side;
  load();
})();
