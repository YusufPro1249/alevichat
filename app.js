import { supabase } from "./supabaseClient.js";

const ROOMS = ["genel", "oyun", "sohbet"];
const MAX_MESSAGE_LENGTH = 1000;
const MAX_REPORT_LENGTH = 500;
const MAX_USERNAME_LENGTH = 40;
const MAX_CITY_LENGTH = 80;
const MAX_ABOUT_LENGTH = 280;

const state = {
  me: null,
  profile: null,
  mode: "room",
  room: "genel",
  dmWith: null,
  users: [],
  blockedByMe: new Set(),
  blockedMe: new Set(),
  dmUnreadByUser: new Map(),
  roomChannel: null,
  dmInChannel: null,
  dmOutChannel: null,
  renderedMessageIds: new Set(),
  selectedUser: null,
  authMode: "login",
  authSubscription: null,
};

const el = {
  roomList: document.getElementById("roomList"),
  userList: document.getElementById("userList"),
  blockedList: document.getElementById("blockedList"),
  userSearch: document.getElementById("userSearch"),
  chatTitle: document.getElementById("chatTitle"),
  chatSub: document.getElementById("chatSub"),
  meBadge: document.getElementById("meBadge"),
  btnProfile: document.getElementById("btnProfile"),
  btnDmInbox: document.getElementById("btnDmInbox"),
  btnLogout: document.getElementById("btnLogout"),
  authCard: document.getElementById("authCard"),
  chatCard: document.getElementById("chatCard"),
  authForm: document.getElementById("authForm"),
  authEmail: document.getElementById("authEmail"),
  authPassword: document.getElementById("authPassword"),
  authUsername: document.getElementById("authUsername"),
  authNote: document.getElementById("authNote"),
  btnLogin: document.getElementById("btnLogin"),
  btnSignup: document.getElementById("btnSignup"),
  messages: document.getElementById("messages"),
  composer: document.getElementById("composer"),
  messageInput: document.getElementById("messageInput"),

  userModal: document.getElementById("userModal"),
  umTitle: document.getElementById("umTitle"),
  umNote: document.getElementById("umNote"),
  btnCloseUserModal: document.getElementById("btnCloseUserModal"),
  btnStartDm: document.getElementById("btnStartDm"),
  btnBlockUser: document.getElementById("btnBlockUser"),
  btnUnblockUser: document.getElementById("btnUnblockUser"),
  btnReportUser: document.getElementById("btnReportUser"),

  profileModal: document.getElementById("profileModal"),
  btnCloseProfile: document.getElementById("btnCloseProfile"),
  profileForm: document.getElementById("profileForm"),
  pfUsername: document.getElementById("pfUsername"),
  pfCity: document.getElementById("pfCity"),
  pfAbout: document.getElementById("pfAbout"),
  pfRole: document.getElementById("pfRole"),
  pfNote: document.getElementById("pfNote"),
};

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function setNote(target, text, bad = false) {
  target.textContent = String(text || "");
  target.classList.toggle("note--bad", bad);
}

function toggleAuth(loggedIn) {
  el.authCard.classList.toggle("hidden", loggedIn);
  el.chatCard.classList.toggle("hidden", !loggedIn);
}

function formatTime(ts) {
  return new Date(ts).toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit" });
}

function normalizeText(input, maxLength) {
  return String(input || "").replace(/\s+/g, " ").trim().slice(0, maxLength);
}

function sanitizeMessage(input) {
  return String(input || "").replace(/\r\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim().slice(0, MAX_MESSAGE_LENGTH);
}

function messageKey(id, kind) {
  return `${kind}:${id}`;
}

function shouldStickBottom() {
  const threshold = 48;
  const remaining = el.messages.scrollHeight - el.messages.scrollTop - el.messages.clientHeight;
  return remaining < threshold;
}

function resetMessages() {
  state.renderedMessageIds.clear();
  el.messages.innerHTML = "";
}

function addMessageRow({ id, username, created_at, message, user_id, kind = state.mode }) {
  if (!id) return;
  const dedupeKey = messageKey(id, kind);
  if (state.renderedMessageIds.has(dedupeKey)) return;
  state.renderedMessageIds.add(dedupeKey);

  const stickBottom = shouldStickBottom();
  const mine = Boolean(state.me && user_id === state.me.id);
  const row = document.createElement("article");
  row.className = `msg ${mine ? "msg--mine" : ""}`;

  const safeName = escapeHtml(username || "user");
  const safeText = escapeHtml(message || "");
  const ts = formatTime(created_at);
  row.innerHTML = `
    <div class="msg__meta">
      <button class="msg__name" type="button" ${mine ? "disabled" : ""}>${safeName}</button>
      <span>${ts}</span>
    </div>
    <div class="msg__text">${safeText}</div>
  `;

  const nameBtn = row.querySelector(".msg__name");
  if (!mine && nameBtn) {
    nameBtn.addEventListener("click", () => {
      const user = state.users.find((u) => u.id === user_id);
      if (user) openUserModal(user);
    });
  }

  el.messages.appendChild(row);
  if (stickBottom) {
    el.messages.scrollTop = el.messages.scrollHeight;
  }
}

function setChatHeader() {
  if (state.mode === "room") {
    el.chatTitle.textContent = `# ${state.room}`;
    el.chatSub.textContent = "Oda sohbeti";
    return;
  }
  el.chatTitle.textContent = `DM · @${state.dmWith?.username || "-"}`;
  el.chatSub.textContent = "Özel mesaj";
}

function getUserById(uid) {
  if (state.profile && state.profile.id === uid) return state.profile;
  return state.users.find((u) => u.id === uid) || null;
}

function renderRooms() {
  el.roomList.innerHTML = "";
  ROOMS.forEach((room) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = `chip ${state.mode === "room" && state.room === room ? "chip--active" : ""}`;
    btn.textContent = `# ${room}`;
    btn.addEventListener("click", async () => {
      await openRoom(room);
    });
    el.roomList.appendChild(btn);
  });
}

function userButtonLabel(user) {
  const unread = state.dmUnreadByUser.get(user.id) || 0;
  return unread > 0 ? `@${user.username} (${unread})` : `@${user.username}`;
}

function renderUsers() {
  const query = el.userSearch.value.trim().toLowerCase();
  const visible = state.users.filter((u) => u.username.toLowerCase().includes(query));
  el.userList.innerHTML = "";
  if (!visible.length) {
    el.userList.innerHTML = `<p class="muted">Kullanıcı bulunamadı.</p>`;
    return;
  }
  visible.forEach((user) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "chip";
    btn.textContent = userButtonLabel(user);
    btn.addEventListener("click", () => openUserModal(user));
    el.userList.appendChild(btn);
  });
}

function renderBlocked() {
  el.blockedList.innerHTML = "";
  const blocked = state.users.filter((u) => state.blockedByMe.has(u.id));
  if (!blocked.length) {
    el.blockedList.innerHTML = `<p class="muted">Engellenen kullanıcı yok.</p>`;
    return;
  }
  blocked.forEach((user) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "chip";
    btn.textContent = `@${user.username}`;
    btn.addEventListener("click", () => openUserModal(user));
    el.blockedList.appendChild(btn);
  });
}

function updateMeBadge() {
  if (!state.me || !state.profile) {
    el.meBadge.textContent = "Giriş yok";
    return;
  }
  const role = state.profile.role === "admin" ? "ADMIN" : "USER";
  el.meBadge.textContent = `${state.profile.username} · ${role}`;
}

async function upsertProfileFromUser(user, usernameInput = "") {
  const usernameDefault = user.email ? user.email.split("@")[0] : `user_${user.id.slice(0, 8)}`;
  const payload = {
    id: user.id,
    email: user.email || "",
    username: normalizeText(usernameInput || usernameDefault, MAX_USERNAME_LENGTH),
    city: "",
    about: "",
    role: "user",
  };
  const { data, error } = await supabase
    .from("profiles")
    .upsert(payload, { onConflict: "id" })
    .select("id, email, username, city, about, role")
    .single();
  if (error) throw error;
  return data;
}

async function loadProfile() {
  const { data, error } = await supabase
    .from("profiles")
    .select("id, email, username, city, about, role")
    .eq("id", state.me.id)
    .maybeSingle();
  if (error) throw error;
  if (!data) {
    state.profile = await upsertProfileFromUser(state.me, "");
  } else {
    state.profile = data;
  }
  localStorage.setItem("alevichat_me", JSON.stringify(state.profile));
}

async function loadUsers() {
  const { data, error } = await supabase
    .from("profiles")
    .select("id, username, city, about, role")
    .neq("id", state.me.id)
    .order("username", { ascending: true });
  if (error) throw error;
  state.users = Array.isArray(data) ? data : [];
}

async function loadBlocks() {
  state.blockedByMe.clear();
  state.blockedMe.clear();

  const { data: byMe, error: byMeErr } = await supabase.from("blocks").select("blocked_user_id").eq("user_id", state.me.id);
  if (byMeErr) throw byMeErr;
  for (const row of byMe || []) state.blockedByMe.add(row.blocked_user_id);

  const { data: meBlockedBy, error: blockedMeErr } = await supabase
    .from("blocks")
    .select("user_id")
    .eq("blocked_user_id", state.me.id);
  if (blockedMeErr) throw blockedMeErr;
  for (const row of meBlockedBy || []) state.blockedMe.add(row.user_id);
}

function canTalkTo(uid) {
  if (!uid) return false;
  if (uid === state.me?.id) return false;
  if (state.blockedByMe.has(uid)) return false;
  if (state.blockedMe.has(uid)) return false;
  return true;
}

function openUserModal(user) {
  state.selectedUser = user;
  el.umTitle.textContent = `@${user.username}`;
  el.btnBlockUser.classList.toggle("hidden", state.blockedByMe.has(user.id));
  el.btnUnblockUser.classList.toggle("hidden", !state.blockedByMe.has(user.id));
  const blockedMeText = state.blockedMe.has(user.id) ? "Bu kullanıcı sizi engellemiş." : "";
  setNote(el.umNote, blockedMeText);
  el.userModal.classList.remove("hidden");
}

function closeUserModal() {
  el.userModal.classList.add("hidden");
}

function openProfileModal() {
  if (!state.profile) return;
  el.pfUsername.value = state.profile.username || "";
  el.pfCity.value = state.profile.city || "";
  el.pfAbout.value = state.profile.about || "";
  if (el.pfRole) el.pfRole.value = state.profile.role || "user";
  setNote(el.pfNote, "");
  el.profileModal.classList.remove("hidden");
}

function closeProfileModal() {
  el.profileModal.classList.add("hidden");
}

async function loadRoomHistory(room) {
  const { data, error } = await supabase
    .from("messages")
    .select("id, user_id, username, room, message, created_at")
    .eq("room", room)
    .order("id", { ascending: true })
    .limit(300);
  if (error) throw error;

  resetMessages();
  for (const msg of data || []) {
    if (state.blockedByMe.has(msg.user_id) || state.blockedMe.has(msg.user_id)) continue;
    addMessageRow({ ...msg, kind: "room" });
  }
  el.messages.scrollTop = el.messages.scrollHeight;
}

async function loadDmHistory(otherUserId) {
  const meId = state.me.id;
  const filter = `and(from_user_id.eq.${meId},to_user_id.eq.${otherUserId}),and(from_user_id.eq.${otherUserId},to_user_id.eq.${meId})`;
  const { data, error } = await supabase
    .from("dms")
    .select("id, from_user_id, to_user_id, message, created_at")
    .or(filter)
    .order("id", { ascending: true })
    .limit(300);
  if (error) throw error;

  resetMessages();
  for (const dm of data || []) {
    const from = getUserById(dm.from_user_id);
    addMessageRow({
      id: dm.id,
      user_id: dm.from_user_id,
      username: from?.username || "user",
      message: dm.message,
      created_at: dm.created_at,
      kind: "dm",
    });
  }
  el.messages.scrollTop = el.messages.scrollHeight;
}

async function safeRemoveChannel(channelRef) {
  if (!channelRef) return;
  try {
    await supabase.removeChannel(channelRef);
  } catch (_error) {
    // Unknown/closed channel durumunda sessiz devam.
  }
}

async function unsubscribeRoom() {
  if (!state.roomChannel) return;
  const current = state.roomChannel;
  state.roomChannel = null;
  await safeRemoveChannel(current);
}

function subscribeRoom(room) {
  state.roomChannel = supabase
    .channel(`room-${room}`)
    .on(
      "postgres_changes",
      {
        event: "INSERT",
        schema: "public",
        table: "messages",
        filter: `room=eq.${room}`,
      },
      (payload) => {
        const msg = payload.new;
        if (state.mode !== "room" || state.room !== room) return;
        if (state.blockedByMe.has(msg.user_id) || state.blockedMe.has(msg.user_id)) return;
        addMessageRow({ ...msg, kind: "room" });
      }
    )
    .subscribe();
}

async function unsubscribeDms() {
  const inCh = state.dmInChannel;
  const outCh = state.dmOutChannel;
  state.dmInChannel = null;
  state.dmOutChannel = null;
  await Promise.all([safeRemoveChannel(inCh), safeRemoveChannel(outCh)]);
}

function subscribeDms() {
  const meId = state.me.id;
  state.dmInChannel = supabase
    .channel(`dm-in-${meId}`)
    .on(
      "postgres_changes",
      {
        event: "INSERT",
        schema: "public",
        table: "dms",
        filter: `to_user_id=eq.${meId}`,
      },
      (payload) => {
        const dm = payload.new;
        if (state.blockedByMe.has(dm.from_user_id) || state.blockedMe.has(dm.from_user_id)) return;

        if (state.mode === "dm" && state.dmWith && dm.from_user_id === state.dmWith.id) {
          const from = getUserById(dm.from_user_id);
          addMessageRow({
            id: dm.id,
            user_id: dm.from_user_id,
            username: from?.username || "user",
            message: dm.message,
            created_at: dm.created_at,
            kind: "dm",
          });
          return;
        }
        const oldCount = state.dmUnreadByUser.get(dm.from_user_id) || 0;
        state.dmUnreadByUser.set(dm.from_user_id, oldCount + 1);
        renderUsers();
      }
    )
    .subscribe();

  state.dmOutChannel = supabase
    .channel(`dm-out-${meId}`)
    .on(
      "postgres_changes",
      {
        event: "INSERT",
        schema: "public",
        table: "dms",
        filter: `from_user_id=eq.${meId}`,
      },
      (payload) => {
        const dm = payload.new;
        if (!(state.mode === "dm" && state.dmWith && dm.to_user_id === state.dmWith.id)) return;
        addMessageRow({
          id: dm.id,
          user_id: dm.from_user_id,
          username: state.profile?.username || "ben",
          message: dm.message,
          created_at: dm.created_at,
          kind: "dm",
        });
      }
    )
    .subscribe();
}

async function loadDmUnreadCounts() {
  state.dmUnreadByUser.clear();
  const meId = state.me.id;
  const { data, error } = await supabase.from("dms").select("from_user_id, created_at").eq("to_user_id", meId).limit(600);
  if (error) throw error;
  for (const row of data || []) {
    if (state.blockedByMe.has(row.from_user_id) || state.blockedMe.has(row.from_user_id)) continue;
    const old = state.dmUnreadByUser.get(row.from_user_id) || 0;
    state.dmUnreadByUser.set(row.from_user_id, old + 1);
  }
}

async function openRoom(room) {
  if (!ROOMS.includes(room)) return;
  await unsubscribeRoom();
  state.mode = "room";
  state.room = room;
  state.dmWith = null;
  setChatHeader();
  renderRooms();
  await loadRoomHistory(room);
  subscribeRoom(room);
}

async function openDmWith(user) {
  if (!canTalkTo(user.id)) {
    alert("Bu kullanıcıyla DM engel nedeniyle kapalı.");
    return;
  }
  state.mode = "dm";
  state.dmWith = user;
  state.dmUnreadByUser.delete(user.id);
  renderUsers();
  setChatHeader();
  renderRooms();
  await unsubscribeRoom();
  await loadDmHistory(user.id);
}

async function sendRoomMessage(text) {
  const cleanText = sanitizeMessage(text);
  if (!cleanText) throw new Error("Boş mesaj gönderilemez.");
  const payload = {
    user_id: state.me.id,
    username: state.profile.username,
    room: state.room,
    message: cleanText,
  };
  const { error } = await supabase.from("messages").insert(payload);
  if (error) throw error;
}

async function sendDm(text) {
  if (!state.dmWith) throw new Error("DM seçilmedi.");
  if (!canTalkTo(state.dmWith.id)) throw new Error("DM engel nedeniyle kapalı.");
  const cleanText = sanitizeMessage(text);
  if (!cleanText) throw new Error("Boş mesaj gönderilemez.");
  const payload = {
    from_user_id: state.me.id,
    to_user_id: state.dmWith.id,
    message: cleanText,
  };
  const { error } = await supabase.from("dms").insert(payload);
  if (error) {
    if (String(error.message || "").includes("from_user_id")) {
      throw new Error("dms tablosu eksik: from_user_id/to_user_id kolonlarını SQL ile oluşturun.");
    }
    throw error;
  }
}

async function blockUser(uid) {
  const { error } = await supabase.from("blocks").insert({ user_id: state.me.id, blocked_user_id: uid });
  if (error && !String(error.message || "").toLowerCase().includes("duplicate")) throw error;
}

async function unblockUser(uid) {
  const { error } = await supabase.from("blocks").delete().eq("user_id", state.me.id).eq("blocked_user_id", uid);
  if (error) throw error;
}

async function reportUser(uid, reason) {
  const cleanReason = normalizeText(reason, MAX_REPORT_LENGTH);
  if (!cleanReason) throw new Error("Rapor nedeni boş olamaz.");
  const { error } = await supabase.from("reports").insert({
    reporter_id: state.me.id,
    target_user_id: uid,
    reason: cleanReason,
  });
  if (error) throw error;
}

async function refreshPeoplePanels() {
  await loadUsers();
  await loadBlocks();
  await loadDmUnreadCounts();
  renderUsers();
  renderBlocked();
}

async function handlePostAuthSetup() {
  await loadProfile();
  toggleAuth(true);
  updateMeBadge();
  await refreshPeoplePanels();
  renderRooms();
  setChatHeader();
  await unsubscribeDms();
  subscribeDms();
  await openRoom(state.room);
}

async function restoreSession() {
  const { data, error } = await supabase.auth.getSession();
  if (error) throw error;
  if (!data.session) {
    state.me = null;
    state.profile = null;
    toggleAuth(false);
    updateMeBadge();
    return;
  }
  state.me = data.session.user;
  await handlePostAuthSetup();
}

async function login(email, password) {
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw error;
  const { data } = await supabase.auth.getUser();
  state.me = data.user;
  await handlePostAuthSetup();
}

async function signup(email, password, username) {
  const cleanUsername = normalizeText(username, MAX_USERNAME_LENGTH);
  if (!cleanUsername) throw new Error("Kullanıcı adı zorunlu.");
  const { data, error } = await supabase.auth.signUp({ email, password });
  if (error) throw error;
  if (!data.user) throw new Error("Kayıt başarısız.");

  await upsertProfileFromUser(data.user, cleanUsername);
  state.me = data.user;
  await handlePostAuthSetup();
}

async function logout(skipRemote = false) {
  await Promise.all([unsubscribeRoom(), unsubscribeDms()]);
  if (!skipRemote) {
    await supabase.auth.signOut();
  }
  state.me = null;
  state.profile = null;
  state.users = [];
  state.mode = "room";
  state.room = ROOMS[0];
  state.dmWith = null;
  state.blockedByMe.clear();
  state.blockedMe.clear();
  state.dmUnreadByUser.clear();
  state.selectedUser = null;
  resetMessages();
  toggleAuth(false);
  updateMeBadge();
  renderRooms();
  renderUsers();
  renderBlocked();
}

function wireEvents() {
  el.btnLogin.addEventListener("click", () => {
    state.authMode = "login";
  });
  el.btnSignup.addEventListener("click", () => {
    state.authMode = "signup";
  });

  el.authForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const email = el.authEmail.value.trim().toLowerCase();
    const password = el.authPassword.value.trim();
    const username = el.authUsername.value.trim();
    try {
      setNote(el.authNote, "");
      if (!email || !password) throw new Error("Email ve şifre zorunlu.");
      if (state.authMode === "signup") {
        if (!username) throw new Error("Kayıt için kullanıcı adı zorunlu.");
        await signup(email, password, username);
        setNote(el.authNote, "Kayıt başarılı.");
      } else {
        await login(email, password);
        setNote(el.authNote, "Giriş başarılı.");
      }
      el.authPassword.value = "";
    } catch (error) {
      setNote(el.authNote, error.message || "İşlem başarısız.", true);
    }
  });

  el.composer.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!state.me) return;
    const text = sanitizeMessage(el.messageInput.value);
    if (!text) return;
    el.messageInput.value = "";
    try {
      if (state.mode === "room") {
        await sendRoomMessage(text);
      } else {
        await sendDm(text);
      }
    } catch (error) {
      alert(error.message || "Mesaj gönderilemedi.");
    }
  });

  el.btnLogout.addEventListener("click", async () => {
    try {
      await logout(false);
    } catch (error) {
      alert(error.message || "Çıkış yapılamadı.");
    }
  });

  el.userSearch.addEventListener("input", renderUsers);

  el.btnCloseUserModal.addEventListener("click", closeUserModal);
  el.userModal.addEventListener("click", (e) => {
    if (e.target === el.userModal) closeUserModal();
  });

  el.btnStartDm.addEventListener("click", async () => {
    if (!state.selectedUser) return;
    closeUserModal();
    await openDmWith(state.selectedUser);
  });

  el.btnBlockUser.addEventListener("click", async () => {
    if (!state.selectedUser) return;
    try {
      await blockUser(state.selectedUser.id);
      await refreshPeoplePanels();
      openUserModal(state.selectedUser);
      setNote(el.umNote, "Kullanıcı engellendi.");
      if (state.dmWith?.id === state.selectedUser.id) {
        await openRoom(state.room);
      }
    } catch (error) {
      setNote(el.umNote, error.message || "Engelleme başarısız.", true);
    }
  });

  el.btnUnblockUser.addEventListener("click", async () => {
    if (!state.selectedUser) return;
    try {
      await unblockUser(state.selectedUser.id);
      await refreshPeoplePanels();
      openUserModal(state.selectedUser);
      setNote(el.umNote, "Engel kaldırıldı.");
    } catch (error) {
      setNote(el.umNote, error.message || "Engel kaldırılamadı.", true);
    }
  });

  el.btnReportUser.addEventListener("click", async () => {
    if (!state.selectedUser) return;
    const reason = prompt("Rapor nedeni:");
    if (!reason) return;
    try {
      await reportUser(state.selectedUser.id, reason);
      setNote(el.umNote, "Rapor gönderildi.");
    } catch (error) {
      setNote(el.umNote, error.message || "Rapor gönderilemedi.", true);
    }
  });

  el.btnProfile.addEventListener("click", openProfileModal);
  el.btnCloseProfile.addEventListener("click", closeProfileModal);
  el.profileModal.addEventListener("click", (e) => {
    if (e.target === el.profileModal) closeProfileModal();
  });
  el.profileForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    try {
      const payload = {
        username: normalizeText(el.pfUsername.value, MAX_USERNAME_LENGTH),
        city: normalizeText(el.pfCity.value, MAX_CITY_LENGTH),
        about: String(el.pfAbout.value || "").trim().slice(0, MAX_ABOUT_LENGTH),
      };
      if (!payload.username) throw new Error("Kullanıcı adı boş olamaz.");
      const { data, error } = await supabase
        .from("profiles")
        .update(payload)
        .eq("id", state.me.id)
        .select("id, email, username, city, about, role")
        .single();
      if (error) throw error;
      state.profile = data;
      localStorage.setItem("alevichat_me", JSON.stringify(data));
      updateMeBadge();
      await refreshPeoplePanels();
      setNote(el.pfNote, "Profil güncellendi.");
    } catch (error) {
      setNote(el.pfNote, error.message || "Profil kaydedilemedi.", true);
    }
  });

  el.btnDmInbox.addEventListener("click", async () => {
    if (!state.users.length) return;
    const sorted = state.users
      .slice()
      .sort((a, b) => (state.dmUnreadByUser.get(b.id) || 0) - (state.dmUnreadByUser.get(a.id) || 0));
    if (sorted[0]) await openDmWith(sorted[0]);
  });

  const { data: authData } = supabase.auth.onAuthStateChange(async (_event, session) => {
    if (!session && state.me) {
      await logout(true);
    }
  });
  state.authSubscription = authData.subscription;

  window.addEventListener("beforeunload", () => {
    unsubscribeRoom();
    unsubscribeDms();
    state.authSubscription?.unsubscribe?.();
  });
}

async function bootstrap() {
  wireEvents();
  renderRooms();
  renderUsers();
  renderBlocked();
  try {
    await restoreSession();
  } catch (error) {
    setNote(el.authNote, error.message || "Başlatma hatası.", true);
    toggleAuth(false);
  }
}

bootstrap();
