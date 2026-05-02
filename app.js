import { supabase } from "./supabaseClient.js";

const ROOMS = [
  { key: "genel-sohbet", label: "Genel Sohbet" },
  { key: "evlilik-sohbeti", label: "Evlilik Sohbeti" },
  { key: "dini-sohbet", label: "Dini Sohbet" },
];

const MAX_MESSAGE_LENGTH = 1000;
const MAX_REASON_LENGTH = 500;

const state = {
  me: null,
  profile: null,
  users: [],
  mode: "room",
  room: ROOMS[0].key,
  dmWith: null,
  selectedUser: null,
  blockedByMe: new Set(),
  blockedMe: new Set(),
  dmUnreadByUser: new Map(),
  renderedIds: new Set(),
  roomChannel: null,
  dmInChannel: null,
  dmOutChannel: null,
  authSub: null,
  adminSelectedUserId: null,
};

const el = {
  roomList: document.getElementById("roomList"),
  userList: document.getElementById("userList"),
  blockedList: document.getElementById("blockedList"),
  userSearch: document.getElementById("userSearch"),
  chatTitle: document.getElementById("chatTitle"),
  chatSub: document.getElementById("chatSub"),
  meBadge: document.getElementById("meBadge"),
  btnDmInbox: document.getElementById("btnDmInbox"),
  btnLogout: document.getElementById("btnLogout"),
  chatCard: document.getElementById("chatCard"),
  messages: document.getElementById("messages"),
  composer: document.getElementById("composer"),
  messageInput: document.getElementById("messageInput"),
  authCard: document.getElementById("authCard"),
  authNote: document.getElementById("authNote"),
  btnShowLogin: document.getElementById("btnShowLogin"),
  btnShowSignup: document.getElementById("btnShowSignup"),
  loginForm: document.getElementById("loginForm"),
  signupForm: document.getElementById("signupForm"),
  loginIdentifier: document.getElementById("loginIdentifier"),
  loginPassword: document.getElementById("loginPassword"),
  suUsername: document.getElementById("suUsername"),
  suFullName: document.getElementById("suFullName"),
  suEmail: document.getElementById("suEmail"),
  suPhone: document.getElementById("suPhone"),
  suPassword: document.getElementById("suPassword"),
  suPassword2: document.getElementById("suPassword2"),
  suAge: document.getElementById("suAge"),
  suCity: document.getElementById("suCity"),
  suAbout: document.getElementById("suAbout"),
  suAvatarUrl: document.getElementById("suAvatarUrl"),
  myAvatar: document.getElementById("myAvatar"),
  myUsername: document.getElementById("myUsername"),
  mySub: document.getElementById("mySub"),
  userModal: document.getElementById("userModal"),
  umTitle: document.getElementById("umTitle"),
  umNote: document.getElementById("umNote"),
  btnCloseUserModal: document.getElementById("btnCloseUserModal"),
  btnStartDm: document.getElementById("btnStartDm"),
  btnBlockUser: document.getElementById("btnBlockUser"),
  btnUnblockUser: document.getElementById("btnUnblockUser"),
  btnReportUser: document.getElementById("btnReportUser"),
  btnProfile: document.getElementById("btnProfile"),
  profileModal: document.getElementById("profileModal"),
  btnCloseProfile: document.getElementById("btnCloseProfile"),
  profileForm: document.getElementById("profileForm"),
  pfUsername: document.getElementById("pfUsername"),
  pfFullName: document.getElementById("pfFullName"),
  pfAge: document.getElementById("pfAge"),
  pfCity: document.getElementById("pfCity"),
  pfHobbies: document.getElementById("pfHobbies"),
  pfAbout: document.getElementById("pfAbout"),
  pfAvatarUrl: document.getElementById("pfAvatarUrl"),
  pfRole: document.getElementById("pfRole"),
  pfNote: document.getElementById("pfNote"),
  userDetailPanel: document.getElementById("userDetailPanel"),
  btnCloseUserDetail: document.getElementById("btnCloseUserDetail"),
  udAvatar: document.getElementById("udAvatar"),
  udFullName: document.getElementById("udFullName"),
  udUsername: document.getElementById("udUsername"),
  udCity: document.getElementById("udCity"),
  udAge: document.getElementById("udAge"),
  udHobbies: document.getElementById("udHobbies"),
  udAbout: document.getElementById("udAbout"),
  udRole: document.getElementById("udRole"),
  udBtnDm: document.getElementById("udBtnDm"),
  udBtnBlock: document.getElementById("udBtnBlock"),
  udBtnUnblock: document.getElementById("udBtnUnblock"),
  udBtnReport: document.getElementById("udBtnReport"),
  udNote: document.getElementById("udNote"),
  adminPanel: document.getElementById("adminPanel"),
  btnAdminPanel: document.getElementById("btnAdminPanel"),
  btnCloseAdmin: document.getElementById("btnCloseAdmin"),
  adminUserSearch: document.getElementById("adminUserSearch"),
  adminUserList: document.getElementById("adminUserList"),
  adminSelectedUser: document.getElementById("adminSelectedUser"),
  adminBanReason: document.getElementById("adminBanReason"),
  adminBanDuration: document.getElementById("adminBanDuration"),
  btnAdminBan: document.getElementById("btnAdminBan"),
  btnAdminUnban: document.getElementById("btnAdminUnban"),
  adminBannedList: document.getElementById("adminBannedList"),
  adminNote: document.getElementById("adminNote"),
};

// ========== YARDIMCI FONKSİYONLAR ==========

function scrollToBottom(force = false) {
  setTimeout(() => {
    if (el.messages) el.messages.scrollTop = el.messages.scrollHeight;
  }, force ? 50 : 0);
}

function escapeHtml(value) {
  return String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;");
}

function setNote(target, text, bad = false) {
  if (!target) return;
  target.textContent = String(text || "");
  target.classList.toggle("note--bad", bad);
}

function normalizeText(value, max = 500) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, max);
}

function sanitizeMessage(value) {
  return String(value || "").replace(/\r\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim().slice(0, MAX_MESSAGE_LENGTH);
}

function formatTime(value) {
  return new Date(value).toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit" });
}

function setAuthMode(mode) {
  const login = mode === "login";
  el.loginForm.classList.toggle("hidden", !login);
  el.signupForm.classList.toggle("hidden", login);
  el.btnShowLogin.classList.toggle("tab--active", login);
  el.btnShowSignup.classList.toggle("tab--active", !login);
  setNote(el.authNote, "");
}

function toggleAuth(loggedIn) {
  el.authCard.classList.toggle("hidden", loggedIn);
  el.chatCard.classList.toggle("hidden", !loggedIn);
}

function getRoomLabel(key) {
  return ROOMS.find((r) => r.key === key)?.label || key;
}

function setHeader() {
  if (state.mode === "room") {
    el.chatTitle.textContent = `# ${getRoomLabel(state.room)}`;
    el.chatSub.textContent = "Canlı oda sohbeti";
  } else {
    el.chatTitle.textContent = `DM · @${state.dmWith?.username || "-"}`;
    el.chatSub.textContent = "Özel mesaj";
  }
}

function updateMeBadge() {
  if (!state.profile) {
    el.meBadge.textContent = "Giriş yok";
    el.myUsername.textContent = "@misafir";
    el.mySub.textContent = "Giriş yapmadınız";
    el.myAvatar.src = "https://placehold.co/64x64";
    if (el.btnAdminPanel) el.btnAdminPanel.style.display = "none";
    return;
  }
  const role = state.profile.role === "admin" ? "ADMIN" : "USER";
  el.meBadge.textContent = `${state.profile.username} · ${role}`;
  el.myUsername.textContent = `@${state.profile.username}`;
  el.mySub.textContent = `${state.profile.full_name || ""} · ${state.profile.city || "-"}`.trim();
  el.myAvatar.src = state.profile.avatar_url || "https://placehold.co/64x64";
  if (el.btnAdminPanel) el.btnAdminPanel.style.display = state.profile.role === "admin" ? "inline-block" : "none";
}

function resetMessages() {
  state.renderedIds.clear();
  el.messages.innerHTML = "";
}

function shouldStickBottom() {
  return (el.messages.scrollHeight - el.messages.scrollTop - el.messages.clientHeight) < 50;
}

function addMessageRow({ id, user_id, username, message, created_at, modeKey }) {
  if (!id) return;
  const dedupe = `${modeKey}:${id}`;
  if (state.renderedIds.has(dedupe)) return;
  state.renderedIds.add(dedupe);
  const autoScroll = shouldStickBottom();
  const mine = state.me && user_id === state.me.id;
  const user = state.users.find((u) => u.id === user_id);
  const row = document.createElement("article");
  row.className = `msg ${mine ? "msg--mine" : ""}`;
  row.innerHTML = `
    <div class="msg__meta">
      <div class="msg__user">
        <img class="msg__avatar" src="${user?.avatar_url || "https://placehold.co/32x32"}" />
        <button class="msg__name" type="button" ${mine ? "disabled" : ""}>${escapeHtml(username || "user")}</button>
      </div>
      <span>${formatTime(created_at)}</span>
    </div>
    <div class="msg__text">${escapeHtml(message || "")}</div>
  `;
  const avatar = row.querySelector(".msg__avatar");
  if (avatar && !mine) avatar.addEventListener("click", () => { const u = state.users.find((u) => u.id === user_id); if (u) openUserDetailPanel(u); });
  if (!mine) { const btn = row.querySelector(".msg__name"); btn?.addEventListener("click", () => { const u = state.users.find((u) => u.id === user_id); if (u) openUserDetailPanel(u); }); }
  el.messages.appendChild(row);
  if (autoScroll) scrollToBottom();
}

function canInteractWith(uid) {
  if (!uid || uid === state.me?.id) return false;
  if (state.blockedByMe.has(uid)) return false;
  if (state.blockedMe.has(uid)) return false;
  return true;
}

async function safeRemoveChannel(ch) { if (!ch) return; try { await supabase.removeChannel(ch); } catch (_e) {} }
async function unsubscribeRoom() { const ch = state.roomChannel; state.roomChannel = null; await safeRemoveChannel(ch); }
async function unsubscribeDms() { const inCh = state.dmInChannel; const outCh = state.dmOutChannel; state.dmInChannel = null; state.dmOutChannel = null; await Promise.all([safeRemoveChannel(inCh), safeRemoveChannel(outCh)]); }

async function loadProfile() {
  const { data, error } = await supabase.from("profiles").select("id, email, username, full_name, phone, age, city, hobbies, about, avatar_url, role").eq("id", state.me.id).maybeSingle();
  if (error) throw error;
  state.profile = data;
}

async function loadUsers() {
  const { data, error } = await supabase.from("profiles").select("id, username, full_name, city, avatar_url, age, hobbies, about, role").neq("id", state.me.id).order("username", { ascending: true });
  if (error) throw error;
  state.users = data || [];
}

async function loadBlocks() {
  state.blockedByMe.clear(); state.blockedMe.clear();
  const { data: byMe } = await supabase.from("blocks").select("blocked_user_id").eq("user_id", state.me.id);
  for (const item of byMe || []) state.blockedByMe.add(item.blocked_user_id);
  const { data: blockedMe } = await supabase.from("blocks").select("user_id").eq("blocked_user_id", state.me.id);
  for (const item of blockedMe || []) state.blockedMe.add(item.user_id);
}

async function loadDmUnreadCounts() {
  state.dmUnreadByUser.clear();
  const { data } = await supabase.from("dms").select("from_user_id").eq("to_user_id", state.me.id).limit(500);
  for (const item of data || []) {
    if (state.blockedByMe.has(item.from_user_id) || state.blockedMe.has(item.from_user_id)) continue;
    state.dmUnreadByUser.set(item.from_user_id, (state.dmUnreadByUser.get(item.from_user_id) || 0) + 1);
  }
}

function renderRooms() {
  el.roomList.innerHTML = "";
  for (const room of ROOMS) {
    const btn = document.createElement("button"); btn.type = "button";
    btn.className = `chip ${state.mode === "room" && state.room === room.key ? "chip--active" : ""}`;
    btn.textContent = `# ${room.label}`;
    btn.addEventListener("click", () => openRoom(room.key));
    el.roomList.appendChild(btn);
  }
}

function renderUsers() {
  const q = el.userSearch.value.trim().toLowerCase();
  const users = state.users.filter((u) => u.username.toLowerCase().includes(q));
  el.userList.innerHTML = "";
  if (!users.length) { el.userList.innerHTML = `<p class="muted">Kullanıcı bulunamadı.</p>`; return; }
  for (const user of users) {
    const unread = state.dmUnreadByUser.get(user.id) || 0;
    const btn = document.createElement("button"); btn.type = "button"; btn.className = "chip";
    btn.textContent = unread > 0 ? `@${user.username} (${unread})` : `@${user.username}`;
    btn.addEventListener("click", () => openUserDetailPanel(user));
    el.userList.appendChild(btn);
  }
}

function renderBlocked() {
  el.blockedList.innerHTML = "";
  const blockedUsers = state.users.filter((u) => state.blockedByMe.has(u.id));
  if (!blockedUsers.length) { el.blockedList.innerHTML = `<p class="muted">Engellenen kullanıcı yok.</p>`; return; }
  for (const user of blockedUsers) {
    const btn = document.createElement("button"); btn.className = "chip"; btn.textContent = `@${user.username}`;
    btn.addEventListener("click", () => openUserDetailPanel(user));
    el.blockedList.appendChild(btn);
  }
}

// ========== ADMIN FONKSİYONLARI ==========

async function loadBannedUsers() {
  const { data, error } = await supabase.from("bans").select("id, user_id, reason, ban_type, expires_at, created_at, is_active").eq("is_active", true).order("created_at", { ascending: false });
  if (error) throw error;
  return data || [];
}

async function checkUserBan(userId) {
  const { data } = await supabase.from("bans").select("id, ban_type, expires_at, is_active").eq("user_id", userId).eq("is_active", true).maybeSingle();
  if (!data) return false;
  if (data.ban_type === "temporary" && data.expires_at && new Date(data.expires_at) < new Date()) {
    await supabase.from("bans").update({ is_active: false }).eq("id", data.id);
    return false;
  }
  return true;
}

async function banUser(userId, reason, duration) {
  const banType = duration === "permanent" ? "permanent" : "temporary";
  let expiresAt = null;
  if (banType === "temporary") expiresAt = new Date(Date.now() + parseInt(duration) * 3600000).toISOString();
  const { error } = await supabase.from("bans").insert({ user_id: userId, banned_by: state.me.id, reason: reason || "Sebep belirtilmedi", ban_type: banType, expires_at: expiresAt });
  if (error) throw error;
}

async function unbanUser(userId) {
  await supabase.from("bans").update({ is_active: false }).eq("user_id", userId).eq("is_active", true);
}

async function renderAdminUserList() {
  const q = el.adminUserSearch.value.trim().toLowerCase();
  const users = state.users.filter((u) => u.username.toLowerCase().includes(q));
  el.adminUserList.innerHTML = "";
  if (!users.length) { el.adminUserList.innerHTML = `<p class="muted">Kullanıcı bulunamadı.</p>`; return; }
  for (const user of users) {
    const isBanned = await checkUserBan(user.id);
    const btn = document.createElement("button"); btn.className = "chip";
    btn.textContent = `@${user.username} ${isBanned ? "🚫" : ""}`;
    btn.addEventListener("click", () => selectAdminUser(user));
    el.adminUserList.appendChild(btn);
  }
}

async function selectAdminUser(user) {
  state.adminSelectedUserId = user.id;
  el.adminSelectedUser.textContent = `Seçili: @${user.username}`;
  const isBanned = await checkUserBan(user.id);
  el.btnAdminBan.style.display = isBanned ? "none" : "block";
  el.btnAdminUnban.style.display = isBanned ? "block" : "none";
  setNote(el.adminNote, isBanned ? "Bu kullanıcı zaten banlı." : "");
}

async function renderBannedList() {
  const bans = await loadBannedUsers();
  el.adminBannedList.innerHTML = "";
  if (!bans.length) { el.adminBannedList.innerHTML = `<p class="muted">Banlı kullanıcı yok.</p>`; return; }
  for (const ban of bans) {
    const user = state.users.find((u) => u.id === ban.user_id);
    const username = user ? `@${user.username}` : ban.user_id.slice(0, 8);
    const expires = ban.expires_at ? new Date(ban.expires_at).toLocaleString("tr-TR") : "Süresiz";
    const div = document.createElement("div"); div.className = "chip";
    div.innerHTML = `<strong>${username}</strong><br><small>Sebep: ${escapeHtml(ban.reason)}</small><br><small>Süre: ${expires}</small>`;
    el.adminBannedList.appendChild(div);
  }
}

function openAdminPanel() {
  if (!state.profile || state.profile.role !== "admin") { alert("Bu özellik sadece adminler içindir."); return; }
  el.adminPanel.classList.remove("hidden");
  renderAdminUserList();
  renderBannedList();
}

function closeAdminPanel() { el.adminPanel.classList.add("hidden"); }

// ========== SAĞ PANEL ==========

function openUserDetailPanel(user) {
  if (!user) return;
  state.selectedUser = user;
  el.udAvatar.src = user.avatar_url || "https://placehold.co/80x80";
  el.udFullName.textContent = user.full_name || "-";
  el.udUsername.textContent = `@${user.username}`;
  el.udCity.textContent = user.city || "-";
  el.udAge.textContent = user.age || "-";
  el.udHobbies.textContent = user.hobbies || "-";
  el.udAbout.textContent = user.about || "-";
  el.udRole.textContent = user.role || "user";
  el.udBtnBlock.style.display = state.blockedByMe.has(user.id) ? "none" : "block";
  el.udBtnUnblock.style.display = state.blockedByMe.has(user.id) ? "block" : "none";
  setNote(el.udNote, state.blockedMe.has(user.id) ? "Bu kullanıcı sizi engellemiş." : "");
  el.userDetailPanel.style.display = "block";
}

function closeUserDetailPanel() { el.userDetailPanel.style.display = "none"; }

function openUserModal(user) {
  state.selectedUser = user;
  el.umTitle.textContent = `@${user.username}`;
  el.btnBlockUser.classList.toggle("hidden", state.blockedByMe.has(user.id));
  el.btnUnblockUser.classList.toggle("hidden", !state.blockedByMe.has(user.id));
  setNote(el.umNote, state.blockedMe.has(user.id) ? "Bu kullanıcı sizi engellemiş." : "");
  el.userModal.classList.remove("hidden");
}

function closeUserModal() { el.userModal.classList.add("hidden"); }

function openProfileModal() {
  if (!state.profile) { alert("Profil bilgisi henüz yüklenmedi."); return; }
  el.pfUsername.value = state.profile.username || "";
  el.pfFullName.value = state.profile.full_name || "";
  el.pfAge.value = state.profile.age || "";
  el.pfCity.value = state.profile.city || "";
  el.pfHobbies.value = state.profile.hobbies || "";
  el.pfAbout.value = state.profile.about || "";
  el.pfAvatarUrl.value = state.profile.avatar_url || "";
  el.pfRole.value = state.profile.role || "user";
  setNote(el.pfNote, "");
  el.profileModal.classList.remove("hidden");
}

function closeProfileModal() { el.profileModal.classList.add("hidden"); }

// ========== VERİ YÜKLEME ==========

async function loadRoomHistory(room) {
  const { data } = await supabase.from("messages").select("id, user_id, username, room, message, created_at").eq("room", room).order("id", { ascending: true }).limit(300);
  resetMessages();
  for (const row of data || []) {
    if (state.blockedByMe.has(row.user_id) || state.blockedMe.has(row.user_id)) continue;
    addMessageRow({ ...row, modeKey: `room:${room}` });
  }
  scrollToBottom(true);
}

async function loadDmHistory(otherId) {
  const me = state.me.id;
  const query = `and(from_user_id.eq.${me},to_user_id.eq.${otherId}),and(from_user_id.eq.${otherId},to_user_id.eq.${me})`;
  const { data } = await supabase.from("dms").select("id, from_user_id, to_user_id, message, created_at").or(query).order("id", { ascending: true }).limit(300);
  resetMessages();
  for (const row of data || []) {
    const name = row.from_user_id === state.me.id ? state.profile?.username : state.users.find((u) => u.id === row.from_user_id)?.username;
    addMessageRow({ id: row.id, user_id: row.from_user_id, username: name || "user", message: row.message, created_at: row.created_at, modeKey: `dm:${otherId}` });
  }
  scrollToBottom(true);
}

// ========== REALTIME ==========

function subscribeRoom(room) {
  state.roomChannel = supabase.channel(`room-${room}`).on("postgres_changes", { event: "INSERT", schema: "public", table: "messages", filter: `room=eq.${room}` }, (payload) => {
    const row = payload.new;
    if (state.mode !== "room" || state.room !== room) return;
    if (state.blockedByMe.has(row.user_id) || state.blockedMe.has(row.user_id)) return;
    addMessageRow({ ...row, modeKey: `room:${room}` });
  }).subscribe();
}

function subscribeDms() {
  const me = state.me.id;
  state.dmInChannel = supabase.channel(`dm-in-${me}`).on("postgres_changes", { event: "INSERT", schema: "public", table: "dms", filter: `to_user_id=eq.${me}` }, (payload) => {
    const row = payload.new;
    if (state.blockedByMe.has(row.from_user_id) || state.blockedMe.has(row.from_user_id)) return;
    if (state.mode === "dm" && state.dmWith?.id === row.from_user_id) {
      const user = state.users.find((u) => u.id === row.from_user_id);
      addMessageRow({ id: row.id, user_id: row.from_user_id, username: user?.username || "user", message: row.message, created_at: row.created_at, modeKey: `dm:${row.from_user_id}` });
    } else { state.dmUnreadByUser.set(row.from_user_id, (state.dmUnreadByUser.get(row.from_user_id) || 0) + 1); renderUsers(); }
  }).subscribe();
  state.dmOutChannel = supabase.channel(`dm-out-${me}`).on("postgres_changes", { event: "INSERT", schema: "public", table: "dms", filter: `from_user_id=eq.${me}` }, (payload) => {
    const row = payload.new;
    if (!(state.mode === "dm" && state.dmWith?.id === row.to_user_id)) return;
    addMessageRow({ id: row.id, user_id: row.from_user_id, username: state.profile?.username || "ben", message: row.message, created_at: row.created_at, modeKey: `dm:${row.to_user_id}` });
  }).subscribe();
}

// ========== AKSİYONLAR ==========

async function openRoom(room) {
  if (!ROOMS.some((r) => r.key === room)) return;
  await unsubscribeRoom();
  state.mode = "room"; state.room = room; state.dmWith = null;
  setHeader(); renderRooms();
  await loadRoomHistory(room);
  subscribeRoom(room);
}

async function openDm(user) {
  if (!canInteractWith(user.id)) { alert("Bu kullanıcıyla DM engel nedeniyle kapalı."); return; }
  state.mode = "dm"; state.dmWith = user;
  state.dmUnreadByUser.delete(user.id);
  renderUsers(); setHeader(); renderRooms();
  await unsubscribeRoom();
  await loadDmHistory(user.id);
}

async function sendRoomMessage(text) {
  const isBanned = await checkUserBan(state.me.id);
  if (isBanned) { alert("Banlandığınız için mesaj gönderemezsiniz."); return; }
  const clean = sanitizeMessage(text);
  if (!clean) throw new Error("Boş mesaj gönderilemez.");
  await supabase.from("messages").insert({ user_id: state.me.id, username: state.profile.username, room: state.room, message: clean });
}

async function sendDmMessage(text) {
  const isBanned = await checkUserBan(state.me.id);
  if (isBanned) { alert("Banlandığınız için mesaj gönderemezsiniz."); return; }
  if (!state.dmWith) throw new Error("DM seçilmedi.");
  if (!canInteractWith(state.dmWith.id)) throw new Error("Engel nedeniyle DM kapalı.");
  const clean = sanitizeMessage(text);
  if (!clean) throw new Error("Boş mesaj gönderilemez.");
  await supabase.from("dms").insert({ from_user_id: state.me.id, to_user_id: state.dmWith.id, message: clean });
}

async function blockUser(userId) { await supabase.from("blocks").insert({ user_id: state.me.id, blocked_user_id: userId }); }
async function unblockUser(userId) { await supabase.from("blocks").delete().eq("user_id", state.me.id).eq("blocked_user_id", userId); }

async function reportUser(userId, reason) {
  const clean = normalizeText(reason, MAX_REASON_LENGTH);
  if (!clean) throw new Error("Rapor sebebi gerekli.");
  await supabase.from("reports").insert({ reporter_id: state.me.id, target_user_id: userId, reason: clean });
}

async function refreshPanels() { await loadUsers(); await loadBlocks(); await loadDmUnreadCounts(); renderUsers(); renderBlocked(); }

async function postAuthSetup() {
  await loadProfile();
  toggleAuth(true); updateMeBadge();
  await refreshPanels();
  renderRooms(); setHeader();
  await unsubscribeDms(); subscribeDms();
  await openRoom(state.room);
}

async function restoreSession() {
  const { data } = await supabase.auth.getSession();
  if (!data.session) { state.me = null; state.profile = null; toggleAuth(false); updateMeBadge(); return; }
  state.me = data.session.user;
  await postAuthSetup();
}

async function resolveEmailFromIdentifier(identifier) {
  const input = normalizeText(identifier, 120).toLowerCase();
  if (!input) throw new Error("Email veya kullanıcı adı zorunlu.");
  if (input.includes("@")) return input;
  const { data } = await supabase.from("profiles").select("email").eq("username", input).maybeSingle();
  if (!data?.email) throw new Error("Kullanıcı bulunamadı.");
  return data.email;
}

async function login(identifier, password) {
  const email = await resolveEmailFromIdentifier(identifier);
  await supabase.auth.signInWithPassword({ email, password });
  const { data } = await supabase.auth.getUser();
  state.me = data.user;
  await postAuthSetup();
}

async function signup(payload) {
  if (!payload.username) throw new Error("Kullanıcı adı zorunlu.");
  if (payload.password !== payload.password2) throw new Error("Şifreler eşleşmiyor.");
  if (!payload.email.includes("@")) throw new Error("Email formatı geçersiz.");
  const { data: existing } = await supabase.from("profiles").select("id").eq("username", payload.username).maybeSingle();
  if (existing) throw new Error("Bu kullanıcı adı kullanılıyor.");
  const { data } = await supabase.auth.signUp({ email: payload.email, password: payload.password });
  if (!data.user) throw new Error("Kayıt başarısız.");
  await supabase.from("profiles").upsert({ id: data.user.id, username: payload.username, full_name: payload.fullName, phone: payload.phone, age: payload.age, city: payload.city, hobbies: "", about: payload.about, avatar_url: payload.avatarUrl, role: "user" }, { onConflict: "id" });
  state.me = data.user;
  await postAuthSetup();
}

async function logout(skipRemote = false) {
  await Promise.all([unsubscribeRoom(), unsubscribeDms()]);
  if (!skipRemote) await supabase.auth.signOut();
  state.me = null; state.profile = null; state.users = [];
  state.mode = "room"; state.room = ROOMS[0].key; state.dmWith = null; state.selectedUser = null;
  state.blockedByMe.clear(); state.blockedMe.clear(); state.dmUnreadByUser.clear();
  resetMessages(); closeUserDetailPanel();
  toggleAuth(false); updateMeBadge(); renderRooms(); renderUsers(); renderBlocked();
}

// ========== EVENTLER ==========

function wireEvents() {
  // MOBİL TOGGLE
  const mobileToggle = document.getElementById("mobileToggle");
  const sidebar = document.querySelector(".sidebar");
  const sidebarOverlay = document.getElementById("sidebarOverlay");
  if (mobileToggle) mobileToggle.addEventListener("click", () => { sidebar.classList.toggle("open"); sidebarOverlay.classList.toggle("open"); });
  if (sidebarOverlay) sidebarOverlay.addEventListener("click", () => { sidebar.classList.remove("open"); sidebarOverlay.classList.remove("open"); });

  el.btnShowLogin.addEventListener("click", () => setAuthMode("login"));
  el.btnShowSignup.addEventListener("click", () => setAuthMode("signup"));

  el.loginForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    try {
      setNote(el.authNote, "");
      const identifier = normalizeText(el.loginIdentifier.value, 120);
      const password = el.loginPassword.value;
      if (!identifier || !password) throw new Error("Tüm alanları doldurun.");
      await login(identifier, password);
      setNote(el.authNote, "Giriş başarılı.");
    } catch (error) { setNote(el.authNote, error.message || "Giriş başarısız.", true); }
  });

  el.signupForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    try {
      setNote(el.authNote, "");
      const payload = {
        username: normalizeText(el.suUsername.value, 40).toLowerCase(),
        fullName: normalizeText(el.suFullName.value, 80),
        email: normalizeText(el.suEmail.value, 120).toLowerCase(),
        phone: normalizeText(el.suPhone.value, 30),
        password: el.suPassword.value, password2: el.suPassword2.value,
        age: Number(el.suAge.value || 0),
        city: normalizeText(el.suCity.value, 80),
        about: normalizeText(el.suAbout.value, 500),
        avatarUrl: normalizeText(el.suAvatarUrl.value, 500),
      };
      if (payload.age < 18 || payload.age > 99) throw new Error("Yaş 18-99 aralığında olmalı.");
      await signup(payload);
      setNote(el.authNote, "Kayıt başarılı.");
    } catch (error) { setNote(el.authNote, error.message || "Kayıt başarısız.", true); }
  });

  el.composer.addEventListener("submit", async (e) => {
    e.preventDefault();
    const text = sanitizeMessage(el.messageInput.value);
    if (!text) return;
    el.messageInput.value = "";
    try { if (state.mode === "room") await sendRoomMessage(text); else await sendDmMessage(text); }
    catch (error) { alert(error.message || "Mesaj gönderilemedi."); }
  });

  el.btnLogout.addEventListener("click", async () => { try { await logout(false); } catch (error) { alert(error.message || "Çıkış başarısız."); } });
  el.userSearch.addEventListener("input", renderUsers);
  el.btnCloseUserDetail.addEventListener("click", closeUserDetailPanel);

  el.udBtnDm.addEventListener("click", async () => {
    if (!state.selectedUser) return;
    if (!canInteractWith(state.selectedUser.id)) { alert("Bu kullanıcıyla DM engel nedeniyle kapalı."); return; }
    await openDm(state.selectedUser);
  });

  el.udBtnBlock.addEventListener("click", async () => {
    if (!state.selectedUser) return;
    try {
      await blockUser(state.selectedUser.id);
      await refreshPanels();
      openUserDetailPanel(state.selectedUser);
      if (state.mode === "dm" && state.dmWith?.id === state.selectedUser.id) await openRoom(state.room);
    } catch (error) { setNote(el.udNote, error.message || "İşlem başarısız.", true); }
  });

  el.udBtnUnblock.addEventListener("click", async () => {
    if (!state.selectedUser) return;
    try { await unblockUser(state.selectedUser.id); await refreshPanels(); openUserDetailPanel(state.selectedUser); }
    catch (error) { setNote(el.udNote, error.message || "İşlem başarısız.", true); }
  });

  el.udBtnReport.addEventListener("click", async () => {
    if (!state.selectedUser) return;
    const reason = prompt("Rapor sebebi:");
    if (!reason) return;
    try { await reportUser(state.selectedUser.id, reason); setNote(el.udNote, "Rapor kaydedildi."); }
    catch (error) { setNote(el.udNote, error.message || "Rapor başarısız.", true); }
  });

  // MODAL
  el.btnCloseUserModal.addEventListener("click", closeUserModal);
  el.userModal.addEventListener("click", (e) => { if (e.target === el.userModal) closeUserModal(); });
  el.btnStartDm.addEventListener("click", async () => { if (!state.selectedUser) return; closeUserModal(); await openDm(state.selectedUser); });
  el.btnBlockUser.addEventListener("click", async () => {
    if (!state.selectedUser) return;
    try { await blockUser(state.selectedUser.id); await refreshPanels(); openUserModal(state.selectedUser); if (state.mode === "dm" && state.dmWith?.id === state.selectedUser.id) await openRoom(state.room); }
    catch (error) { setNote(el.umNote, error.message || "İşlem başarısız.", true); }
  });
  el.btnUnblockUser.addEventListener("click", async () => {
    if (!state.selectedUser) return;
    try { await unblockUser(state.selectedUser.id); await refreshPanels(); openUserModal(state.selectedUser); }
    catch (error) { setNote(el.umNote, error.message || "İşlem başarısız.", true); }
  });
  el.btnReportUser.addEventListener("click", async () => {
    if (!state.selectedUser) return;
    const reason = prompt("Rapor sebebi:"); if (!reason) return;
    try { await reportUser(state.selectedUser.id, reason); setNote(el.umNote, "Rapor kaydedildi."); }
    catch (error) { setNote(el.umNote, error.message || "Rapor başarısız.", true); }
  });

  // PROFİL
  el.btnProfile.addEventListener("click", openProfileModal);
  el.btnCloseProfile.addEventListener("click", closeProfileModal);
  el.profileModal.addEventListener("click", (e) => { if (e.target === el.profileModal) closeProfileModal(); });
  el.profileForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    try {
      const payload = { full_name: normalizeText(el.pfFullName.value, 80), age: Number(el.pfAge.value || 0), city: normalizeText(el.pfCity.value, 80), hobbies: normalizeText(el.pfHobbies.value, 180), about: normalizeText(el.pfAbout.value, 500), avatar_url: normalizeText(el.pfAvatarUrl.value, 500) };
      if (payload.age && (payload.age < 18 || payload.age > 99)) throw new Error("Yaş 18-99 aralığında olmalı.");
      const { data } = await supabase.from("profiles").update(payload).eq("id", state.me.id).select("id, email, username, full_name, phone, age, city, hobbies, about, avatar_url, role").single();
      state.profile = data;
      updateMeBadge(); await refreshPanels();
      setNote(el.pfNote, "Profil güncellendi.");
    } catch (error) { setNote(el.pfNote, error.message || "Güncelleme başarısız.", true); }
  });

  el.btnDmInbox.addEventListener("click", async () => {
    if (!state.users.length) return;
    const top = state.users.slice().sort((a, b) => (state.dmUnreadByUser.get(b.id) || 0) - (state.dmUnreadByUser.get(a.id) || 0))[0];
    if (top) await openDm(top);
  });

  // ADMIN PANEL
  el.btnAdminPanel.addEventListener("click", openAdminPanel);
  el.btnCloseAdmin.addEventListener("click", closeAdminPanel);
  el.adminUserSearch.addEventListener("input", renderAdminUserList);
  el.btnAdminBan.addEventListener("click", async () => {
    if (!state.adminSelectedUserId) return;
    try {
      await banUser(state.adminSelectedUserId, el.adminBanReason.value.trim(), el.adminBanDuration.value);
      setNote(el.adminNote, "Kullanıcı banlandı.");
      el.adminBanReason.value = "";
      await renderAdminUserList(); await renderBannedList();
    } catch (error) { setNote(el.adminNote, error.message || "Banlama başarısız.", true); }
  });
  el.btnAdminUnban.addEventListener("click", async () => {
    if (!state.adminSelectedUserId) return;
    try {
      await unbanUser(state.adminSelectedUserId);
      setNote(el.adminNote, "Ban kaldırıldı.");
      await renderAdminUserList(); await renderBannedList();
    } catch (error) { setNote(el.adminNote, error.message || "İşlem başarısız.", true); }
  });

  supabase.auth.onAuthStateChange(async (_evt, session) => { if (!session && state.me) await logout(true); });
  window.addEventListener("beforeunload", () => { unsubscribeRoom(); unsubscribeDms(); });
}

async function bootstrap() {
  setAuthMode("login");
  wireEvents();
  renderRooms(); renderUsers(); renderBlocked();
  try { await restoreSession(); } catch (error) { setNote(el.authNote, error.message || "Başlatma hatası.", true); toggleAuth(false); }
}

bootstrap();
