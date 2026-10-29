// app.js — Nghiệp vụ: 2 bên riêng biệt, tiền null ≠ 0, thống kê tính lại sau mỗi thay đổi.
(function () {
  'use strict';
  const DB = window.CuoiDB;
  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));

  let side = 'trai';
  let savedScroll = 0;
  let filters = { search: '', group: '', invited: '', returned: '', money: '' };
  try {
    const savedSide = localStorage.getItem('cuoi_last_side');
    if (savedSide === 'trai' || savedSide === 'gai') side = savedSide;
    const savedFilters = JSON.parse(localStorage.getItem('cuoi_last_filters') || 'null');
    if (savedFilters && typeof savedFilters === 'object') {
      filters.search = typeof savedFilters.search === 'string' ? savedFilters.search : '';
      filters.group = typeof savedFilters.group === 'string' ? savedFilters.group : '';
      filters.invited = savedFilters.invited === 'da' || savedFilters.invited === 'chua' ? savedFilters.invited : '';
      // Chỉ kiểm tra kiểu ở đây (renderStatusFilter sẽ xóa nếu mã không còn tồn tại),
      // vì danh sách trạng thái được định nghĩa sau đoạn này, gọi getAllStatuses() ở đây sẽ lỗi TDZ.
      filters.returned = typeof savedFilters.returned === 'string' ? savedFilters.returned : '';
      filters.money = savedFilters.money === 'co' || savedFilters.money === 'chua' ? savedFilters.money : '';
    }
    savedScroll = Number(localStorage.getItem('cuoi_last_scroll') || 0) || 0;
  } catch (e) {}
  let guests = [];
  let groups = [];
  // Các mục đang thu gọn, lưu lại để lần mở sau vẫn thu gọn như cũ.
  let collapsedGroups = new Set();
  try {
    const savedCollapsed = JSON.parse(localStorage.getItem('cuoi_collapsed_groups') || '[]');
    if (Array.isArray(savedCollapsed)) collapsedGroups = new Set(savedCollapsed.filter((x) => typeof x === 'string'));
  } catch (e) {}
  function saveCollapsedGroups() {
    try { localStorage.setItem('cuoi_collapsed_groups', JSON.stringify(Array.from(collapsedGroups))); } catch (e) {}
  }
  let editingGuest = null; // {id|null, invited, returned}
  let editingGroup = null;
  let newGroupParentId = null; // khi bấm + Mục con, mục mới sẽ là con của mục này
  let pendingImport = null;
  let confirmCallback = null;
  let confirmCancelCallback = null;
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
  function groupsFor(s) {
    // Thứ tự hiển thị có phân cấp: mục gốc theo order, ngay sau mỗi mục gốc là các mục con của nó theo order.
    const out = [];
    groups.filter((g) => g.side === s && !g.parentId).sort((a, b) => a.order - b.order).forEach((top) => {
      out.push(top);
      groups.filter((g) => g.side === s && g.parentId === top.id).sort((a, b) => a.order - b.order).forEach((c) => out.push(c));
    });
    return out;
  }
  function topGroupsFor(s) { return groups.filter((g) => g.side === s && !g.parentId).sort((a, b) => a.order - b.order); }
  function childrenOf(parentId, s) { return groups.filter((g) => g.side === s && g.parentId === parentId).sort((a, b) => a.order - b.order); }
  function siblingsOf(gr) { return gr.parentId ? childrenOf(gr.parentId, gr.side) : topGroupsFor(gr.side); }
  function groupParent(gr) { return gr && gr.parentId ? groups.find((x) => x.id === gr.parentId) : null; }
  function guestsFor(s) { return guests.filter((g) => g.side === s); }
  function groupName(id) {
    const g = groups.find((x) => x.id === id);
    if (!g) return 'Khác';
    const par = groupParent(g);
    return par ? par.name + ' / ' + g.name : g.name;
  }

  const DEFAULT_STATUSES = [
    { id: 'cho', label: 'Mình chưa mừng dịp gì' },
    { id: 'da', label: 'Mình đã mừng cưới' },
    { id: 'thang', label: 'Chơi đầy tháng' },
    { id: 'hieu', label: 'Đám hiếu' },
    { id: 'om', label: 'Thăm ốm' },
  ];
  let customStatuses = [];
  try {
    const saved = JSON.parse(localStorage.getItem('cuoi_custom_statuses') || '[]');
    if (Array.isArray(saved)) customStatuses = saved.filter((s) => s && typeof s.id === 'string' && typeof s.label === 'string' && s.label.trim() && !DEFAULT_STATUSES.some((d) => d.id === s.id));
  } catch (e) {}
  function getAllStatuses() { return DEFAULT_STATUSES.concat(customStatuses); }
  function saveCustomStatuses() { try { localStorage.setItem('cuoi_custom_statuses', JSON.stringify(customStatuses)); } catch (e) {} }
  function returnedLabel(v) { const s = getAllStatuses().find((x) => x.id === v); return s ? s.label : DEFAULT_STATUSES[0].label; }
  function returnedClass(v) { return v === 'cho' ? 'waiting' : 'occasion'; }
  function nextReturned(v) {
    const list = getAllStatuses();
    const i = list.findIndex((x) => x.id === v);
    return list[(i + 1) % list.length].id;
  }

  function calcStats(list) {
    const total = list.length;
    const invited = list.filter((g) => g.invited).length;
    const withMoneyList = list.filter((g) => g.amount !== null && g.amount !== undefined);
    const totalMoney = withMoneyList.reduce((sum, g) => sum + g.amount, 0);
    return {
      total, invited, notInvited: total - invited, totalMoney,
      withMoney: withMoneyList.length, noMoney: total - withMoneyList.length,
      statusCounts: getAllStatuses().reduce((acc, s) => { acc[s.id] = list.filter((g) => g.returned === s.id).length; return acc; }, {}),
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
    $('#statusStats').innerHTML = getAllStatuses().map((s) =>
      '<div class="stat' + (filters.returned === s.id ? ' active' : '') + '" data-stat="status:' + esc(s.id) + '" role="button" tabindex="0"><b>' + (st.statusCounts[s.id] || 0) + '</b><span>' + esc(s.label) + '</span></div>').join('');
    const setStatActive = (id, on) => { const el = $(id); if (el && el.parentElement) el.parentElement.classList.toggle('active', !!on); };
    setStatActive('#statInvited', filters.invited === 'da');
    setStatActive('#statNotInvited', filters.invited === 'chua');
    setStatActive('#statWithMoney', filters.money === 'co');
    setStatActive('#statNoMoney', filters.money === 'chua');
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

  function renderStatusFilter() {
    const sel = $('#filterReturned');
    const prev = filters.returned;
    sel.innerHTML = '<option value="">Mừng: Tất cả</option>' + getAllStatuses().map((s) =>
      '<option value="' + esc(s.id) + '"' + (s.id === prev ? ' selected' : '') + '>' + esc(s.label) + '</option>').join('');
    if (prev && !getAllStatuses().some((s) => s.id === prev)) { filters.returned = ''; sel.value = ''; }
  }

  function renderGroupFilter() {
    const sel = $('#filterGroup');
    const prev = filters.group;
    sel.innerHTML = '<option value="">Tất cả các nhóm</option>' + groupsFor(side).map((g) =>
      '<option value="' + esc(g.id) + '"' + (g.id === prev ? ' selected' : '') + '>' + esc(groupName(g.id)) + '</option>').join('');
  }

  function filteredGuests(groupId) {
    let list = guests.filter((g) => g.side === side && g.groupId === groupId);
    if (filters.group) {
      const fg = groups.find((x) => x.id === filters.group);
      const isSelf = groupId === filters.group;
      const isChildOfFilter = fg && !fg.parentId && (groups.find((x) => x.id === groupId) || {}).parentId === filters.group;
      if (!isSelf && !isChildOfFilter) return [];
    }
    if (filters.search) {
      const q = filters.search.toLowerCase();
      list = list.filter((g) => g.name.toLowerCase().includes(q) || (g.note || '').toLowerCase().includes(q));
    }
    if (filters.invited === 'da') list = list.filter((g) => g.invited);
    if (filters.invited === 'chua') list = list.filter((g) => !g.invited);
    if (filters.money === 'co') list = list.filter((g) => g.amount !== null && g.amount !== undefined);
    if (filters.money === 'chua') list = list.filter((g) => g.amount === null || g.amount === undefined);
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
        '<div class="guest-sub">' + esc(groupName(g.groupId)) + (g.peopleCount ? ' • ' + g.peopleCount + ' người' : '') + (g.amount === null ? ' • Chưa nhập tiền' : ' • ' + DB.formatAmount(g.amount) + ' VNĐ') + '</div></div>' +
        '<button type="button" class="pill ' + (g.invited ? 'invited' : 'notinvited') + '" data-toggle-invite="' + esc(g.id) + '">' + (g.invited ? 'Đã mời' : 'Chưa mời') + '</button>' +
      '</div>' +
      '<div class="guest-middle">' +
        '<div class="money-wrap"><input type="text" inputmode="decimal" data-money="' + esc(g.id) + '" value="' + esc(moneyVal) + '" placeholder="Tiền mừng" aria-label="Tiền mừng của ' + esc(g.name) + '"><span>VNĐ</span></div>' +
        '<button type="button" class="pill ' + returnedClass(g.returned) + '" data-toggle-returned="' + esc(g.id) + '">' + returnedLabel(g.returned) + '</button>' +
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
          '<option value="' + esc(gr.id) + '"' + (gr.id === g.groupId ? ' selected' : '') + '>' + esc(groupName(gr.id)) + '</option>').join('') + '</select>' +
        '<label>Ghi chú</label><textarea data-note="' + esc(g.id) + '" maxlength="1000" placeholder="Ví dụ: Đã gửi thiệp, cần gọi xác nhận…">' + esc(g.note || '') + '</textarea>' +
        '<p class="muted small" style="margin:6px 0 0">Ghi chú lưu tự động khi bạn rời khỏi ô nhập.</p>' +
      '</div>' +
    '</article>';
  }

  function renderList() {
    const wrap = $('#guestList');
    const topGroups = topGroupsFor(side);
    let html = '';
    let totalShown = 0;
    let shownGroups = 0;
    const filtering = filters.search || filters.group || filters.invited || filters.returned || filters.money;
    // Một mục con: header + danh sách khách của riêng nó, thụt vào trong mục cha.
    function childSectionHTML(gr) {
      const list = filteredGuests(gr.id);
      if (filtering && list.length === 0) return { html: '', count: 0 };
      const allInGroup = guests.filter((g) => g.side === side && g.groupId === gr.id);
      const invitedInGroup = allInGroup.filter((g) => g.invited).length;
      const collapsed = collapsedGroups.has(gr.id);
      let h = '<section class="subgroup" data-group-section="' + esc(gr.id) + '"><div class="subgroup-head"><div><h4>' + esc(gr.name) + '</h4>' +
        '<div class="count">' + invitedInGroup + '/' + allInGroup.length + ' đã mời' + (collapsed ? ' • Đã thu gọn' : '') + '</div></div>' +
        '<div class="group-actions">' +
          '<button type="button" class="mini-btn" data-group-collapse="' + esc(gr.id) + '" aria-label="' + (collapsed ? 'Mở rộng mục' : 'Thu gọn mục') + '">' + (collapsed ? '▸' : '▾') + '</button>' +
          '<button type="button" class="mini-btn" data-group-up="' + esc(gr.id) + '" aria-label="Đưa mục con lên trên">↑</button>' +
          '<button type="button" class="mini-btn" data-group-down="' + esc(gr.id) + '" aria-label="Đưa mục con xuống dưới">↓</button>' +
          '<button type="button" class="mini-btn" data-group-rename="' + esc(gr.id) + '">Đổi tên</button>' +
          '<button type="button" class="mini-btn danger" data-group-delete="' + esc(gr.id) + '">Xóa mục</button>' +
        '</div></div>';
      h += '<div class="subgroup-body"' + (collapsed ? ' hidden' : '') + '>';
      if (list.length === 0) h += '<p class="muted small" style="padding:0 2px">Chưa có khách trong mục này.</p>';
      else h += list.map(guestCardHTML).join('');
      h += '</div></section>';
      return { html: h, count: list.length };
    }
    topGroups.forEach((gr) => {
      const children = childrenOf(gr.id, side);
      const directList = filteredGuests(gr.id);
      const childParts = children.map(childSectionHTML);
      const childShown = childParts.filter((x) => x.html);
      if (filtering && directList.length === 0 && childShown.length === 0) return;
      totalShown += directList.length + childParts.reduce((s, x) => s + x.count, 0);
      const altClass = (shownGroups % 2 === 1) ? ' group-alt' : '';
      shownGroups++;
      const subtreeIds = [gr.id].concat(children.map((c) => c.id));
      const allInGroup = guests.filter((g) => g.side === side && subtreeIds.includes(g.groupId));
      const invitedInGroup = allInGroup.filter((g) => g.invited).length;
      const collapsed = collapsedGroups.has(gr.id);
      html += '<section class="group' + altClass + '" data-group-section="' + esc(gr.id) + '"><div class="group-head"><div><h3>' + esc(gr.name) + '</h3>' +
        '<div class="count">' + invitedInGroup + '/' + allInGroup.length + ' đã mời' + (collapsed ? ' • Đã thu gọn' : '') + '</div></div>' +
        '<div class="group-actions">' +
          '<button type="button" class="mini-btn" data-group-collapse="' + esc(gr.id) + '" aria-label="' + (collapsed ? 'Mở rộng mục' : 'Thu gọn mục') + '">' + (collapsed ? '▸' : '▾') + '</button>' +
          '<button type="button" class="mini-btn" data-group-up="' + esc(gr.id) + '" aria-label="Đưa nhóm lên trên">↑</button>' +
          '<button type="button" class="mini-btn" data-group-down="' + esc(gr.id) + '" aria-label="Đưa nhóm xuống dưới">↓</button>' +
          '<button type="button" class="mini-btn" data-group-rename="' + esc(gr.id) + '">Đổi tên</button>' +
          '<button type="button" class="mini-btn danger" data-group-delete="' + esc(gr.id) + '">Xóa mục</button>' +
          '<button type="button" class="mini-btn" data-group-add-child="' + esc(gr.id) + '">+ Mục con</button>' +
        '</div></div>';
      html += '<div class="group-body"' + (collapsed ? ' hidden' : '') + '>';
      if (directList.length > 0) html += directList.map(guestCardHTML).join('');
      else if (children.length === 0) html += '<p class="muted small" style="padding:0 2px">Chưa có khách trong nhóm này.</p>';
      childShown.forEach((x) => { html += x.html; });
      html += '</div></section>';
    });
    // Nút Thêm mục mới ở cuối danh sách cho dễ thấy, ngoài nút ở thanh công cụ.
    html += '<div class="card add-group-card"><button type="button" class="add-group-bottom" data-add-group>＋ Thêm mục mới</button><p class="muted small" style="text-align:center;margin:6px 0 0">Tạo thêm một mục khách mời cho bên đang chọn.</p></div>';
    wrap.innerHTML = html;
    $('#emptyState').hidden = !(topGroups.length === 0 || (totalShown === 0 && !filters.search && !filters.group && !filters.invited && !filters.returned && !filters.money && guestsFor(side).length === 0));
    if (totalShown === 0 && guestsFor(side).length > 0) {
      wrap.innerHTML = '<div class="card empty"><b>Không tìm thấy khách phù hợp</b><span>Thử đổi từ khóa hoặc bộ lọc.</span></div>';
    }
    renderActiveFilterBar();
    if (activeStat) renderStatDetail();
  }

  function renderActiveFilterBar() {
    const bar = $('#activeFilterBar');
    if (!bar) return;
    if (activeStat) { bar.hidden = true; return; }
    const parts = [];
    if (filters.group) parts.push('Nhóm: ' + groupName(filters.group));
    if (filters.invited === 'da') parts.push('Đã mời');
    if (filters.invited === 'chua') parts.push('Chưa mời');
    if (filters.returned) parts.push(returnedLabel(filters.returned));
    if (filters.money === 'co') parts.push('Có tiền mừng');
    if (filters.money === 'chua') parts.push('Chưa nhập tiền');
    if (filters.search) parts.push('Tìm: ' + filters.search);
    if (parts.length === 0) { bar.hidden = true; return; }
    bar.hidden = false;
    $('#activeFilterText').textContent = 'Đang xem: ' + parts.join(' • ') + ' — danh sách xếp A → Z, bấm lại vào ô thống kê để bỏ lọc.';
  }
  let activeStat = null; // ô thống kê đang mở list phẳng, null = xem danh sách theo mục như cũ
  function statLabelFor(stat) {
    if (stat === 'all') return 'Tất cả khách';
    if (stat === 'invited') return 'Đã mời';
    if (stat === 'notinvited') return 'Chưa mời';
    if (stat === 'withmoney') return 'Có tiền mừng';
    if (stat === 'nomoney') return 'Chưa nhập tiền';
    if (stat.startsWith('status:')) return returnedLabel(stat.slice(7));
    return 'Tất cả khách';
  }
  function getStatGuests(stat) {
    let list = guestsFor(side);
    if (stat === 'all') { /* giữ nguyên */ }
    else if (stat === 'invited') list = list.filter((g) => g.invited);
    else if (stat === 'notinvited') list = list.filter((g) => !g.invited);
    else if (stat === 'withmoney') list = list.filter((g) => g.amount !== null && g.amount !== undefined);
    else if (stat === 'nomoney') list = list.filter((g) => g.amount === null || g.amount === undefined);
    else if (stat.startsWith('status:')) list = list.filter((g) => g.returned === stat.slice(7));
    else return [];
    return list.sort((a, b) => a.name.localeCompare(b.name, 'vi', { sensitivity: 'base' }));
  }
  function getExportGuests() {
    // Xuất đúng danh sách đang xem: nếu đang mở list phẳng thống kê thì xuất list đó,
    // nếu không thì xuất danh sách của bên đang chọn sau khi áp bộ lọc hiện tại (tìm, nhóm, mời, mừng, tiền), xếp A → Z.
    if (activeStat) return getStatGuests(activeStat);
    let list = guestsFor(side);
    if (filters.group) {
      const fg = groups.find((x) => x.id === filters.group);
      list = list.filter((g) => g.groupId === filters.group || (fg && !fg.parentId && (groups.find((x) => x.id === g.groupId) || {}).parentId === filters.group));
    }
    if (filters.search) {
      const q = filters.search.toLowerCase();
      list = list.filter((g) => g.name.toLowerCase().includes(q) || (g.note || '').toLowerCase().includes(q));
    }
    if (filters.invited === 'da') list = list.filter((g) => g.invited);
    if (filters.invited === 'chua') list = list.filter((g) => !g.invited);
    if (filters.money === 'co') list = list.filter((g) => g.amount !== null && g.amount !== undefined);
    if (filters.money === 'chua') list = list.filter((g) => g.amount === null || g.amount === undefined);
    if (filters.returned) list = list.filter((g) => g.returned === filters.returned);
    return list.sort((a, b) => a.name.localeCompare(b.name, 'vi', { sensitivity: 'base' }));
  }
  function buildExportText(list) {
    const invited = list.filter((g) => g.invited).length;
    const scope = activeStat ? 'Đang xem: ' + statLabelFor(activeStat) : (filters.group ? 'Nhóm: ' + groupName(filters.group) : 'Tất cả các nhóm');
    const lines = [];
    lines.push('Danh sách khách mời - ' + sideName(side));
    lines.push(scope);
    list.forEach((g, i) => {
      lines.push((i + 1) + '. ' + g.name + ' - ' + groupName(g.groupId) + ' - ' + (g.invited ? 'Đã mời' : 'Chưa mời'));
    });
    lines.push('Tổng: ' + list.length + ' khách (' + invited + ' đã mời, ' + (list.length - invited) + ' chưa mời)');
    return lines.join('\n');
  }
  function openTextExport() {
    const list = getExportGuests();
    if (list.length === 0) { toast('Không có khách nào trong danh sách đang xem.'); return; }
    $('#textExportContent').value = buildExportText(list);
    $('#textExportSummary').textContent = list.length + ' khách • chỉ gồm tên, nhóm và trạng thái mời, xếp A → Z.';
    openOverlay('#textExportModal');
    setTimeout(() => { const ta = $('#textExportContent'); ta.focus(); ta.select(); }, 60);
  }
  function renderStatDetail() {
    const panel = $('#statDetail');
    if (!panel) return;
    if (!activeStat) { panel.hidden = true; const gl = $('#guestList'); if (gl) gl.hidden = false; return; }
    const list = getStatGuests(activeStat);
    $('#statDetailTitle').textContent = 'Đang xem: ' + statLabelFor(activeStat);
    $('#statDetailSub').textContent = list.length + ' khách • xếp A → Z • bấm Đóng để về danh sách theo mục.';
    $('#statDetailList').innerHTML = list.length === 0
      ? '<div class="card empty"><b>Không có khách nào thuộc ô này</b><span>Thử bấm ô khác.</span></div>'
      : list.map(guestCardHTML).join('');
    panel.hidden = false;
    const gl = $('#guestList'); if (gl) gl.hidden = true;
    const es = $('#emptyState'); if (es) es.hidden = true;
  }
  function closeStatDetailView() {
    if (!activeStat) return;
    activeStat = null;
    const panel = $('#statDetail'); if (panel) panel.hidden = true;
    const gl = $('#guestList'); if (gl) gl.hidden = false;
  }
  function renderAll() { renderStats(); renderGroupFilter(); renderStatusFilter(); renderList(); renderActiveFilterBar(); }

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
    g.returned = nextReturned(g.returned);
    const btn = document.querySelector('[data-toggle-returned="' + CSS.escape(id) + '"]');
    if (btn) {
      btn.textContent = returnedLabel(g.returned);
      btn.className = 'pill ' + returnedClass(g.returned);
    }
    saveGuestRecord(g, true).then(() => { renderStats(); if (activeStat) renderStatDetail(); }).catch(() => renderAll());
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
  function isFamilyGroup(groupId) {
    const gr = groups.find((x) => x.id === groupId);
    return !!(gr && gr.name.trim() === 'Gia đình');
  }
  function clampPeople(n) {
    n = parseInt(n, 10);
    if (Number.isNaN(n)) return 1;
    return Math.min(99, Math.max(1, n));
  }
  function setPeople(n) {
    const v = clampPeople(n);
    $('#fPeople').value = v;
    if (editingGuest) editingGuest.peopleCount = v;
    return v;
  }
  function updatePeopleField() {
    const show = isFamilyGroup($('#fGroup').value);
    $('#peopleField').hidden = !show;
  }
  function openGuestForm(guest) {
    editingGuest = guest
      ? { id: guest.id, invited: guest.invited, returned: guest.returned, peopleCount: (Number.isInteger(guest.peopleCount) ? guest.peopleCount : null) }
      : { id: null, invited: false, returned: 'cho', peopleCount: 1 };
    $('#guestModalTitle').textContent = guest ? 'Sửa khách mời' : 'Thêm khách mời';
    $('#fName').value = guest ? guest.name : '';
    const sel = $('#fGroup');
    const myGroups = groupsFor(side);
    // Sửa thì giữ nhóm của khách đó; thêm mới thì lấy nhóm lần nhập trước, nếu nhóm đó không còn thì về nhóm đầu tiên.
    let defaultGroupId = guest ? guest.groupId : getLastGroupId(side);
    if (!myGroups.find((gr) => gr.id === defaultGroupId)) defaultGroupId = myGroups[0] ? myGroups[0].id : '';
    sel.innerHTML = myGroups.map((gr) => '<option value="' + esc(gr.id) + '"' + (gr.id === defaultGroupId ? ' selected' : '') + '>' + esc(groupName(gr.id)) + '</option>').join('');
    $('#fAmount').value = guest && guest.amount !== null && guest.amount !== undefined ? DB.formatAmount(guest.amount) : '';
    $('#fNote').value = guest ? (guest.note || '') : '';
    $('#fPeople').value = editingGuest.peopleCount || 1;
    updatePeopleField();
    $('#guestFormError').hidden = true;
    updateGuestSegments();
    openOverlay('#guestModal');
    setTimeout(() => $('#fName').focus(), 60);
  }
  function renderStatusButtons() {
    const wrap = $('#statusButtons');
    if (!wrap || !editingGuest) return;
    wrap.innerHTML = getAllStatuses().map((s) =>
      '<button class="seg status-btn' + (editingGuest.returned === s.id ? ' active' : '') + '" type="button" data-status="' + esc(s.id) + '">' + esc(s.label) + '</button>').join('') +
      '<button class="seg add-status-btn" type="button" data-add-status>+ Thêm trạng thái</button>';
  }
  function updateGuestSegments() {
    $('#segInvited').classList.toggle('active', !!editingGuest.invited);
    $('#segNotInvited').classList.toggle('active', !editingGuest.invited);
    renderStatusButtons();
  }

  // ---------- Xác nhận ----------
  function askConfirm(title, text, okLabel, extraHTML, cb, onCancel) {
    $('#confirmTitle').textContent = title;
    $('#confirmText').textContent = text;
    $('#confirmExtra').innerHTML = extraHTML || '';
    $('#btnConfirmOk').textContent = okLabel || 'Xác nhận xóa';
    confirmCallback = cb;
    confirmCancelCallback = onCancel || null;
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
      .then(([gs, grs]) => { guests = gs || []; groups = grs || []; // Chuẩn hóa mục con cũ/lỗi: mục cha không tồn tại, khác bên, là mục con, hoặc tự trỏ chính mình thì về mục gốc.
        groups.forEach((g) => { if (g.parentId) { const par = groups.find((x) => x.id === g.parentId); if (!par || par.side !== g.side || par.parentId || par.id === g.id) g.parentId = null; } });
        return normalizeOrphans(); })
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
      closeStatDetailView();
      side = t.dataset.tab;
      filters.group = '';
      $('#filterGroup').value = '';
      renderAll();
      window.scrollTo(0, 0);
      saveView();
      return;
    }
    if (t.dataset.inviteFilter !== undefined) {
      closeStatDetailView();
      filters.invited = t.dataset.inviteFilter;
      $('#filterInvited').value = filters.invited;
      $$('[data-invite-filter]').forEach((b) => b.classList.toggle('active', b.dataset.inviteFilter === filters.invited));
      renderList(); saveView();
      return;
    }
    if (t.dataset.status !== undefined) {
      if (editingGuest) { editingGuest.returned = t.dataset.status; updateGuestSegments(); }
      return;
    }
    if (t.dataset.addStatus !== undefined) {
      $('#statusModalTitle').textContent = 'Thêm trạng thái mới';
      $('#sName').value = '';
      openOverlay('#statusModal');
      setTimeout(() => $('#sName').focus(), 60);
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
      const gr0 = groups.find((x) => x.id === gid);
      const list = gr0 ? siblingsOf(gr0) : [];
      const idx = list.findIndex((x) => x.id === gid);
      const swapIdx = id('groupUp') ? idx - 1 : idx + 1;
      if (idx < 0 || swapIdx < 0 || swapIdx >= list.length) return;
      const a = list[idx], b = list[swapIdx];
      const tmp = a.order; a.order = b.order; b.order = tmp;
      Promise.all([DB.saveGroup(a), DB.saveGroup(b)]).then(renderAll);
      return;
    }
    if (id('groupCollapse')) {
      const gid = id('groupCollapse');
      const section = document.querySelector('[data-group-section="' + CSS.escape(gid) + '"]');
      const body = section ? Array.from(section.children).find((c) => c.classList.contains('group-body') || c.classList.contains('subgroup-body')) : null;
      if (body) {
        body.hidden = !body.hidden;
        const nowCollapsed = body.hidden;
        if (nowCollapsed) collapsedGroups.add(gid); else collapsedGroups.delete(gid);
        saveCollapsedGroups();
        t.textContent = nowCollapsed ? '▸' : '▾';
        t.setAttribute('aria-label', nowCollapsed ? 'Mở rộng mục' : 'Thu gọn mục');
        const countEl = section.querySelector('.count');
        if (countEl) {
          const base = countEl.textContent.replace(' • Đã thu gọn', '');
          countEl.textContent = nowCollapsed ? base + ' • Đã thu gọn' : base;
        }
      }
      return;
    }
    if (t.dataset.collapseAll !== undefined) {
      const myGroups = groupsFor(side);
      const anyOpen = myGroups.some((g) => !collapsedGroups.has(g.id));
      myGroups.forEach((g) => { if (anyOpen) collapsedGroups.add(g.id); else collapsedGroups.delete(g.id); });
      saveCollapsedGroups();
      renderList();
      return;
    }
    if (t.dataset.addGroup !== undefined) {
      editingGroup = null; newGroupParentId = null;
      $('#groupModalTitle').textContent = 'Thêm mục mới';
      $('#gName').value = '';
      openOverlay('#groupModal');
      setTimeout(() => $('#gName').focus(), 60);
      return;
    }
    if (t.dataset.groupAddChild !== undefined) {
      const parent = groups.find((x) => x.id === t.dataset.groupAddChild);
      if (!parent) return;
      editingGroup = null; newGroupParentId = parent.id;
      $('#groupModalTitle').textContent = 'Thêm mục con cho “' + parent.name + '”';
      $('#gName').value = '';
      openOverlay('#groupModal');
      setTimeout(() => $('#gName').focus(), 60);
      return;
    }
    if (id('groupRename')) {
      const gr = groups.find((x) => x.id === id('groupRename'));
      if (!gr) return;
      editingGroup = gr;
      $('#groupModalTitle').textContent = 'Đổi tên mục';
      $('#gName').value = gr.name;
      openOverlay('#groupModal');
      setTimeout(() => $('#gName').focus(), 60);
      return;
    }
    if (id('groupDelete')) {
      const gr = groups.find((x) => x.id === id('groupDelete'));
      if (!gr) return;
      const childGroups = childrenOf(gr.id, side);
      const inGroup = guests.filter((x) => x.side === side && x.groupId === gr.id);
      const others = groupsFor(side).filter((x) => x.id !== gr.id);
      const removeGroupLocally = () => {
        groups = groups.filter((x) => x.id !== gr.id);
        collapsedGroups.delete(gr.id); saveCollapsedGroups();
      };
      // Xóa mục cha: các mục con không bị xóa, chúng trở thành mục gốc.
      const promoteChildren = () => {
        if (childGroups.length === 0) return Promise.resolve();
        const topMax = topGroupsFor(side).reduce((m, g) => Math.max(m, g.order), -1);
        return Promise.all(childGroups.map((c, i) => { c.parentId = null; c.order = topMax + 1 + i; return DB.saveGroup(c); }));
      };
      if (inGroup.length === 0 && childGroups.length === 0) {
        askConfirm('Xóa mục?', 'Xóa mục “' + groupName(gr.id) + '” không? Mục này đang trống.', 'Xóa mục', '', () => {
          DB.deleteGroup(gr.id).then(() => { removeGroupLocally(); renderAll(); toast('Đã xóa mục.'); });
        });
      } else if (inGroup.length === 0 && childGroups.length > 0) {
        askConfirm('Xóa mục cha?', 'Mục “' + gr.name + '” đang có ' + childGroups.length + ' mục con. Các mục con sẽ trở thành mục gốc, không bị xóa cùng. Bạn có chắc muốn xóa mục cha?', 'Xóa mục cha', '', () => {
          promoteChildren().then(() => DB.deleteGroup(gr.id)).then(() => load()).then(() => toast('Đã xóa mục cha, các mục con đã thành mục gốc.'));
        });
      } else if (others.length === 0) {
        toast('Không thể xóa mục cuối cùng khi vẫn còn khách. Hãy chuyển khách sang mục mới trước.');
      } else {
        const opts = others.map((o) => '<option value="' + esc(o.id) + '">' + esc(groupName(o.id)) + '</option>').join('');
        askConfirm('Xóa mục có khách?', 'Mục “' + groupName(gr.id) + '” đang có ' + inGroup.length + ' khách. Chọn mục để chuyển toàn bộ khách sang trước khi xóa:', 'Chuyển khách và xóa mục',
          '<label style="display:block;font-size:14px;font-weight:600;margin:10px 0 5px">Chuyển sang mục</label><select id="deleteGroupTarget" style="width:100%;min-height:46px;border:1px solid #e5e0da;border-radius:11px;padding:10px">' + opts + '</select>', () => {
            const target = $('#deleteGroupTarget').value;
            const moves = inGroup.map((g) => { g.groupId = target; g.updatedAt = DB.nowISO(); return DB.saveGuest(g); });
            Promise.all(moves).then(() => promoteChildren()).then(() => DB.deleteGroup(gr.id)).then(() => { collapsedGroups.delete(gr.id); saveCollapsedGroups(); return load(); }).then(() => toast('Đã chuyển khách và xóa mục.'));
          });
      }
      return;
    }
  });

  // Bấm ô thống kê -> lọc và sổ ra danh sách khách thuộc ô đó, xếp A → Z (renderList đã xếp A → Z).
  // Bấm lại vào cùng 1 ô thì bỏ lọc ô đó. Bấm ô khác thì đổi sang lọc ô đó.
  document.addEventListener('click', (e) => {
    const el = e.target.closest('[data-stat]');
    if (!el) return;
    // Không chặn bấm nút bên trong ô (nếu có).
    if (e.target.closest('button')) return;
    const stat = el.dataset.stat;
    let label = '';
    if (stat === 'all') {
      filters = { search: '', group: '', invited: '', returned: '', money: '' };
      $('#searchInput').value = ''; $('#filterGroup').value = ''; $('#filterInvited').value = ''; $('#filterReturned').value = '';
      label = 'Tất cả khách';
    } else {
      // Lọc theo ô mới, xóa các lọc thống kê khác để danh sách không bị giao nhau khó hiểu.
      const prevInvited = filters.invited, prevReturned = filters.returned, prevMoney = filters.money;
      filters.invited = ''; filters.returned = ''; filters.money = '';
      if (stat === 'invited') { filters.invited = prevInvited === 'da' ? '' : 'da'; label = 'Đã mời'; }
      else if (stat === 'notinvited') { filters.invited = prevInvited === 'chua' ? '' : 'chua'; label = 'Chưa mời'; }
      else if (stat === 'withmoney') { filters.money = prevMoney === 'co' ? '' : 'co'; label = 'Có tiền mừng'; }
      else if (stat === 'nomoney') { filters.money = prevMoney === 'chua' ? '' : 'chua'; label = 'Chưa nhập tiền'; }
      else if (stat.startsWith('status:')) {
        const sid = stat.slice(7);
        filters.returned = prevReturned === sid ? '' : sid;
        label = returnedLabel(sid);
      } else return;
      $('#filterInvited').value = filters.invited;
      $('#filterReturned').value = filters.returned;
      if (filters.invited === '' && filters.returned === '' && filters.money === '') label = 'Đã bỏ lọc, xem tất cả';
      else label = 'Đang xem: ' + label;
    }
    // List phẳng hiện ngay dưới thống kê, không chia theo mục.
    if (stat === 'all') {
      // 'all' đã xóa hết lọc ở trên, đóng panel để về danh sách theo mục đầy đủ.
      closeStatDetailView();
      renderAll(); saveView();
      toast(label);
      return;
    }
    const wasActive = activeStat === stat;
    if (wasActive) {
      // Bấm lại cùng ô: đóng panel, về danh sách theo mục, xóa lọc ô đó.
      activeStat = null;
      filters.invited = ''; filters.returned = ''; filters.money = '';
      $('#filterInvited').value = ''; $('#filterReturned').value = '';
      const panel = $('#statDetail'); if (panel) panel.hidden = true;
      const gl = $('#guestList'); if (gl) gl.hidden = false;
      renderAll(); saveView();
      toast('Đã bỏ lọc, xem tất cả');
      return;
    }
    activeStat = stat;
    renderStats(); renderStatDetail(); saveView();
    const panel = $('#statDetail');
    if (panel) panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
    toast(label);
  });
  $('#btnCloseStatDetail').addEventListener('click', () => {
    activeStat = null;
    filters.invited = ''; filters.returned = ''; filters.money = '';
    $('#filterInvited').value = ''; $('#filterReturned').value = '';
    const panel = $('#statDetail'); if (panel) panel.hidden = true;
    const gl = $('#guestList'); if (gl) gl.hidden = false;
    renderAll(); saveView();
  });
  $('#btnExportText').addEventListener('click', openTextExport);
  const btnExportStat = $('#btnExportTextStat');
  if (btnExportStat) btnExportStat.addEventListener('click', openTextExport);
  $('#btnCloseTextExport').addEventListener('click', closeAll);
  $('#btnCopyTextExport').addEventListener('click', () => {
    const ta = $('#textExportContent');
    ta.focus(); ta.select();
    const done = () => toast('Đã sao chép danh sách.');
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(ta.value).then(done).catch(() => { try { document.execCommand('copy'); done(); } catch (e) { toast('Không sao chép được, hãy chọn và sao chép thủ công.'); } });
    } else {
      try { document.execCommand('copy'); done(); } catch (e) { toast('Không sao chép được, hãy chọn và sao chép thủ công.'); }
    }
  });
  $('#btnDownloadTextExport').addEventListener('click', () => {
    const blob = new Blob([$('#textExportContent').value], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'cuoi-chung-minh-danh-sach-' + side + '-' + new Date().toISOString().slice(0, 10) + '.txt';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    toast('Đã tải file Text.');
  });
  $('#btnClearFilters').addEventListener('click', () => {
    closeStatDetailView();
    filters = { search: '', group: '', invited: '', returned: '', money: '' };
    $('#searchInput').value = ''; $('#filterGroup').value = ''; $('#filterInvited').value = ''; $('#filterReturned').value = '';
    renderAll(); saveView();
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

  $('#searchInput').addEventListener('input', (e) => { closeStatDetailView(); filters.search = e.target.value.trim(); renderList(); saveView(); });
  $('#filterGroup').addEventListener('change', (e) => { closeStatDetailView(); filters.group = e.target.value; renderList(); saveView(); });
  $('#filterInvited').addEventListener('change', (e) => { closeStatDetailView();
    filters.invited = e.target.value;
    $$('[data-invite-filter]').forEach((b) => b.classList.toggle('active', b.dataset.inviteFilter === filters.invited));
    renderList(); saveView();
  });
  $('#filterReturned').addEventListener('change', (e) => { closeStatDetailView(); filters.returned = e.target.value; renderList(); saveView(); });

  $('#btnAddGuest').addEventListener('click', () => openGuestForm(null));
  $('#btnCancelGuest').addEventListener('click', closeAll);
  $('#segInvited').addEventListener('click', () => { editingGuest.invited = true; updateGuestSegments(); });
  $('#segNotInvited').addEventListener('click', () => { editingGuest.invited = false; updateGuestSegments(); });
  $('#fGroup').addEventListener('change', () => { updatePeopleField(); });
  $('#btnPeopleMinus').addEventListener('click', () => { setPeople((parseInt($('#fPeople').value, 10) || 1) - 1); });
  $('#btnPeoplePlus').addEventListener('click', () => { setPeople((parseInt($('#fPeople').value, 10) || 1) + 1); });
  $('#fPeople').addEventListener('blur', () => { setPeople($('#fPeople').value); });
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
    const peopleCount = isFamilyGroup(groupId) ? clampPeople($('#fPeople').value) : null;
    if (!groupId) { toast('Chưa có nhóm nào. Hãy thêm nhóm trước.'); return; }
    saving = true;
    $('#btnSaveGuest').disabled = true;
    const rec = editingGuest.id
      ? Object.assign({}, guests.find((x) => x.id === editingGuest.id), { name, groupId, invited: editingGuest.invited, amount, returned: editingGuest.returned, peopleCount, note: $('#fNote').value })
      : { id: DB.uid(), side, name, groupId, invited: editingGuest.invited, amount, returned: editingGuest.returned, peopleCount, note: $('#fNote').value, createdAt: DB.nowISO(), updatedAt: DB.nowISO() };
    saveGuestRecord(rec, true).then(() => {
      saving = false; $('#btnSaveGuest').disabled = false;
      // Chỉ lưu nhóm khi đã lưu thành công; bấm Hủy thì không đổi nhóm mặc định.
      setLastGroupId(side, groupId);
      closeAll(); renderAll(); toast(editingGuest.id ? 'Đã cập nhật khách mời.' : 'Đã thêm khách mời.');
    }).catch(() => { saving = false; $('#btnSaveGuest').disabled = false; });
  });

  $('#btnAddGroup').addEventListener('click', () => {
    editingGroup = null; newGroupParentId = null;
    $('#groupModalTitle').textContent = 'Thêm mục mới';
    $('#gName').value = '';
    openOverlay('#groupModal');
    setTimeout(() => $('#gName').focus(), 60);
  });
  $('#btnCancelGroup').addEventListener('click', closeAll);
  $('#btnCancelStatus').addEventListener('click', closeAll);
  $('#statusForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const name = $('#sName').value.trim();
    if (!name) { toast('Tên trạng thái là bắt buộc.'); return; }
    if (getAllStatuses().some((s) => s.label.toLowerCase() === name.toLowerCase())) { toast('Trạng thái này đã có.'); return; }
    const rec = { id: 'custom_' + DB.uid(), label: name };
    customStatuses.push(rec); saveCustomStatuses();
    closeAll(); renderStatusButtons(); renderStatusFilter(); renderStats();
    toast('Đã thêm trạng thái: ' + name);
  });
  $('#groupForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const name = $('#gName').value.trim();
    if (!name) { toast('Tên mục là bắt buộc.'); return; }
    if (editingGroup) {
      editingGroup.name = name;
      DB.saveGroup(editingGroup).then(() => { closeAll(); renderAll(); toast('Đã đổi tên mục.'); });
    } else {
      const parentId = newGroupParentId || null;
      const siblings = parentId ? childrenOf(parentId, side) : topGroupsFor(side);
      const maxOrder = siblings.reduce((m, g) => Math.max(m, g.order), -1);
      const gr = { id: DB.uid(), side, name, order: maxOrder + 1, createdAt: DB.nowISO() };
      if (parentId) gr.parentId = parentId;
      DB.saveGroup(gr).then(() => { groups.push(gr); newGroupParentId = null; closeAll(); renderAll(); toast(parentId ? 'Đã thêm mục con.' : 'Đã thêm mục mới.'); });
    }
  });

  $('#btnConfirmCancel').addEventListener('click', () => { const cb = confirmCancelCallback; confirmCallback = null; confirmCancelCallback = null; closeAll(); if (cb) cb(); });
  $('#btnConfirmOk').addEventListener('click', () => { const cb = confirmCallback; confirmCallback = null; confirmCancelCallback = null; closeAll(); if (cb) cb(); });

  $$('.overlay').forEach((o) => o.addEventListener('click', (e) => { if (e.target === o) o.classList.remove('open'); }));

  $('#btnToggleCombined').addEventListener('click', () => {
    const box = $('#combinedBox');
    box.hidden = !box.hidden;
    $('#btnToggleCombined').textContent = box.hidden ? 'Xem tổng hợp 2 bên ▾' : 'Ẩn tổng hợp 2 bên ▴';
  });

  // ---------- Chi / Thu đám cưới: mở từ Cài đặt, lưu LocalStorage, chung cho cả đám cưới ----------
  let chiThuItems = [];
  try {
    const savedCT = JSON.parse(localStorage.getItem('cuoi_chi_thu') || '[]');
    if (Array.isArray(savedCT)) chiThuItems = savedCT.filter((x) => x && typeof x.name === 'string' && Number.isInteger(x.amount) && x.amount >= 0 && (x.kind === 'chi' || x.kind === 'thu'));
  } catch (e) { chiThuItems = []; }
  let chiThuKind = 'chi';
  let chiThuFilter = null; // null = tất cả, 'thu' = chỉ thu, 'chi' = chỉ chi (bấm vào ô Tổng thu / Tổng chi)
  function saveChiThu() { try { localStorage.setItem('cuoi_chi_thu', JSON.stringify(chiThuItems)); } catch (e) {} }
  function renderChiThu() {
    const thu = chiThuItems.filter((x) => x.kind === 'thu').reduce((s, x) => s + x.amount, 0);
    const chi = chiThuItems.filter((x) => x.kind === 'chi').reduce((s, x) => s + x.amount, 0);
    $('#chiThuTotalThu').textContent = DB.formatAmount(thu) + ' VNĐ';
    $('#chiThuTotalChi').textContent = DB.formatAmount(chi) + ' VNĐ';
    const remainEl = $('#chiThuRemain');
    remainEl.textContent = DB.formatAmount(thu - chi) + ' VNĐ';
    remainEl.style.color = (thu - chi) < 0 ? '#a33333' : '#2f5f7d';
    const listEl = $('#chiThuList');
    if (chiThuItems.length === 0) {
      const note0 = $('#chiThuFilterNote'); if (note0) note0.hidden = true;
      listEl.innerHTML = '<div class="card empty"><b>Chưa có mục chi / thu nào</b><span>Thêm mục đầu tiên ở trên.</span></div>';
      return;
    }
    const noteEl = $('#chiThuFilterNote');
    if (noteEl) {
      if (chiThuFilter) {
        const n = chiThuItems.filter((x) => x.kind === chiThuFilter).length;
        noteEl.textContent = 'Đang xem: ' + (chiThuFilter === 'thu' ? 'Thu' : 'Chi') + ' (' + n + ' mục) — bấm lại vào ô đó hoặc bấm Còn lại để xem tất cả.';
        noteEl.hidden = false;
      } else noteEl.hidden = true;
    }
    const statThu = $('#chiThuStatThu'); if (statThu) statThu.classList.toggle('active', chiThuFilter === 'thu');
    const statChi = $('#chiThuStatChi'); if (statChi) statChi.classList.toggle('active', chiThuFilter === 'chi');
    const statAll = $('#chiThuStatAll'); if (statAll) statAll.classList.toggle('active', chiThuFilter === null);
    const visible = chiThuFilter ? chiThuItems.filter((x) => x.kind === chiThuFilter) : chiThuItems;
    if (visible.length === 0) {
      listEl.innerHTML = '<div class="card empty"><b>Không có mục ' + (chiThuFilter === 'thu' ? 'thu' : 'chi') + ' nào</b><span>Bấm Còn lại để xem tất cả.</span></div>';
      return;
    }
    const sorted = visible.slice().sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
    listEl.innerHTML = sorted.map((x) => '<div class="chi-thu-item"><div style="display:flex;justify-content:space-between;gap:8px;align-items:flex-start"><div style="min-width:0"><b>' + esc(x.name) + '</b><div class="muted small">' + (x.kind === 'thu' ? 'Thu' : 'Chi') + (x.note ? ' • ' + esc(x.note) : '') + '</div></div>' +
      '<div style="text-align:right;white-space:nowrap"><div class="' + (x.kind === 'thu' ? 'chi-thu-amount-thu' : 'chi-thu-amount-chi') + '">' + (x.kind === 'thu' ? '+' : '-') + DB.formatAmount(x.amount) + ' VNĐ</div>' +
      '<button type="button" class="text-btn" data-chi-thu-edit="' + esc(x.id) + '">Sửa</button> <button type="button" class="text-btn danger" data-chi-thu-delete="' + esc(x.id) + '">Xóa</button></div></div></div>').join('');
  }
  function updateChiThuSegments() {
    $('#chiThuSegChi').classList.toggle('active', chiThuKind === 'chi');
    $('#chiThuSegThu').classList.toggle('active', chiThuKind === 'thu');
  }
  let chiThuEditingId = null;
  function cancelChiThuEdit() {
    chiThuEditingId = null;
    $('#ctName').value = ''; $('#ctAmount').value = ''; $('#ctNote').value = '';
    chiThuKind = 'chi'; updateChiThuSegments();
    const sb = $('#chiThuSubmitBtn'); if (sb) sb.textContent = '+ Thêm mục';
    const cb = $('#btnCancelChiThuEdit'); if (cb) cb.hidden = true;
    const err = $('#chiThuFormError'); if (err) err.hidden = true;
  }
  function startChiThuEdit(item) {
    chiThuEditingId = item.id;
    $('#ctName').value = item.name;
    $('#ctAmount').value = DB.formatAmount(item.amount);
    $('#ctNote').value = item.note || '';
    chiThuKind = item.kind; updateChiThuSegments();
    const sb = $('#chiThuSubmitBtn'); if (sb) sb.textContent = 'Lưu thay đổi';
    const cb = $('#btnCancelChiThuEdit'); if (cb) cb.hidden = false;
    const err = $('#chiThuFormError'); if (err) err.hidden = true;
    const form = $('#chiThuForm'); if (form) form.scrollIntoView({ behavior: 'smooth', block: 'start' });
    $('#ctName').focus();
  }

  // Cài đặt / sao lưu
  $('#btnSettings').addEventListener('click', () => openOverlay('#settingsModal'));
  $('#btnCloseSettings').addEventListener('click', closeAll);
  $('#btnChiThu').addEventListener('click', () => { closeAll(); cancelChiThuEdit(); renderChiThu(); updateChiThuSegments(); openOverlay('#chiThuModal'); });
  $('#btnCloseChiThu').addEventListener('click', closeAll);
  $('#btnCloseChiThuTop').addEventListener('click', closeAll);
  $('#chiThuSegChi').addEventListener('click', () => { chiThuKind = 'chi'; updateChiThuSegments(); });
  $('#chiThuSegThu').addEventListener('click', () => { chiThuKind = 'thu'; updateChiThuSegments(); });
  $('#chiThuStatThu').addEventListener('click', () => { chiThuFilter = (chiThuFilter === 'thu' ? null : 'thu'); renderChiThu(); });
  $('#chiThuStatChi').addEventListener('click', () => { chiThuFilter = (chiThuFilter === 'chi' ? null : 'chi'); renderChiThu(); });
  $('#chiThuStatAll').addEventListener('click', () => { chiThuFilter = null; renderChiThu(); });
  $$('#chiThuForm .quick-row button').forEach((b) => b.addEventListener('click', () => {
    const input = $('#ctAmount');
    if (b.dataset.ctQuick) { input.value = DB.formatAmount(Number(b.dataset.ctQuick)); }
    else if (b.dataset.ctAppend) {
      const digits = input.value.replace(/\D/g, '');
      if (digits) input.value = DB.formatAmount(Number(digits + '000'));
    }
    input.focus();
  }));
  $('#btnCancelChiThuEdit').addEventListener('click', cancelChiThuEdit);
  $('#chiThuForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const name = $('#ctName').value.trim();
    const amount = DB.parseAmount($('#ctAmount').value);
    const err = $('#chiThuFormError');
    if (!name) { err.textContent = 'Tên mục là bắt buộc.'; err.hidden = false; $('#ctName').focus(); return; }
    if (Number.isNaN(amount) || amount === null) { err.textContent = 'Số tiền không hợp lệ. Chỉ nhập số.'; err.hidden = false; return; }
    err.hidden = true;
    if (chiThuEditingId) {
      const item = chiThuItems.find((x) => x.id === chiThuEditingId);
      if (item) { item.name = name; item.amount = amount; item.note = $('#ctNote').value.trim(); item.kind = chiThuKind; }
      chiThuFilter = null;
      saveChiThu(); renderChiThu(); cancelChiThuEdit();
      toast('Đã lưu thay đổi.');
    } else {
      chiThuItems.push({ id: DB.uid(), kind: chiThuKind, name, amount, note: $('#ctNote').value.trim(), createdAt: DB.nowISO() });
      chiThuFilter = null;
      saveChiThu(); renderChiThu();
      $('#ctName').value = ''; $('#ctAmount').value = ''; $('#ctNote').value = '';
      toast('Đã thêm mục ' + (chiThuKind === 'thu' ? 'thu' : 'chi') + '.');
    }
  });
  $('#chiThuList').addEventListener('click', (e) => {
    const editBtn = e.target.closest('[data-chi-thu-edit]');
    if (editBtn) {
      const item = chiThuItems.find((x) => x.id === editBtn.dataset.chiThuEdit);
      if (item) startChiThuEdit(item);
      return;
    }
    const btn = e.target.closest('[data-chi-thu-delete]');
    if (!btn) return;
    const item = chiThuItems.find((x) => x.id === btn.dataset.chiThuDelete);
    if (!item) return;
    const reopenChiThu = () => { renderChiThu(); openOverlay('#chiThuModal'); };
    askConfirm('Xóa mục?', 'Xóa mục “' + item.name + '” (' + DB.formatAmount(item.amount) + ' VNĐ) không?', 'Xóa mục', '', () => {
      chiThuItems = chiThuItems.filter((x) => x.id !== item.id);
      if (chiThuEditingId === item.id) cancelChiThuEdit();
      saveChiThu(); reopenChiThu(); toast('Đã xóa mục.');
    }, reopenChiThu);
  });
  $('#btnExport').addEventListener('click', () => {
    const data = { app: 'cuoi-chung-minh', version: 1, exportedAt: new Date().toISOString(), groups, guests, customStatuses };
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
  function restoreCustomStatusesFromImport(data) {
    if (!data || !Array.isArray(data.customStatuses)) return;
    let changed = false;
    data.customStatuses.forEach((s) => {
      if (s && typeof s.id === 'string' && typeof s.label === 'string' && s.label.trim() && !getAllStatuses().some((x) => x.id === s.id || x.label.toLowerCase() === s.label.toLowerCase())) {
        customStatuses.push({ id: s.id, label: s.label.trim() }); changed = true;
      }
    });
    if (changed) saveCustomStatuses();
  }
  function sanitizeImportedGroup(gr, allGroups) {
    if (!gr.parentId || gr.parentId === gr.id) return null;
    const par = allGroups.find((x) => x.id === gr.parentId);
    if (!par || par.side !== gr.side || par.parentId) return null;
    return gr.parentId;
  }
  $('#btnImportMerge').addEventListener('click', () => {
    if (!pendingImport) return;
    restoreCustomStatusesFromImport(pendingImport);
    const ops = [];
    pendingImport.groups.forEach((gr) => { if (gr.id && gr.name) { const clean = Object.assign({}, gr); clean.parentId = sanitizeImportedGroup(gr, groups.concat(pendingImport.groups)); if (!clean.parentId) delete clean.parentId; ops.push(DB.saveGroup(clean)); } });
    pendingImport.guests.forEach((g) => {
      const rec = {
        id: g.id || DB.uid(), side: g.side, name: String(g.name).trim(),
        groupId: g.groupId || '', invited: !!g.invited,
        amount: (g.amount === null || g.amount === undefined) ? null : g.amount,
        returned: getAllStatuses().some((s) => s.id === g.returned) ? g.returned : 'cho',
        peopleCount: (Number.isInteger(g.peopleCount) && g.peopleCount >= 1 && g.peopleCount <= 99) ? g.peopleCount : null, note: g.note || '',
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
        restoreCustomStatusesFromImport(pendingImport);
        Promise.all([DB.clear('guests'), DB.clear('groups')]).then(() => {
          const ops = [];
          pendingImport.groups.forEach((gr) => { const clean = Object.assign({}, gr); clean.parentId = sanitizeImportedGroup(gr, pendingImport.groups); if (!clean.parentId) delete clean.parentId; ops.push(DB.saveGroup(clean)); });
          pendingImport.guests.forEach((g) => ops.push(DB.saveGuest({
            id: g.id || DB.uid(), side: g.side, name: String(g.name).trim(), groupId: g.groupId || '',
            invited: !!g.invited, amount: (g.amount === null || g.amount === undefined) ? null : g.amount,
            returned: getAllStatuses().some((s) => s.id === g.returned) ? g.returned : 'cho',
        peopleCount: (Number.isInteger(g.peopleCount) && g.peopleCount >= 1 && g.peopleCount <= 99) ? g.peopleCount : null, note: g.note || '',
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
