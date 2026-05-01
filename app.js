import { supabase } from "./supabaseClient.js";

const ROOMS = ["genel", "oyun", "sohbet"];

const state = {
  me: null,
  profile: null,
  mode: "room", // room | dm
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
  target.textContent = text;
  target.classList.toggle("note--bad", bad);
}

function toggleAuth(loggedIn) {
  el.authCard.classList.toggle("hidden", loggedIn);
  el.chatCard.classList.toggle("hidden", !loggedIn);
}

function formatTime(ts) {
  return new Date(ts).toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit" });
}

function resetMessages() {
  state.renderedMessageIds.clear();
  el.messages.innerHTML = "";
}

function addMessageRow({ id, username, created_at, message, user_id }) {
  if (!id || state.renderedMessageIds.has(id)) return;
  state.renderedMessageIds.add(id);

  const mine = state.me && user_id === state.me.id;
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
  if (!mine) {
    nameBtn.addEventListener("click", () => {
      const user = state.users.find((u) => u.id === user_id);
      if (user) openUserModal(user);
    });
  }

  el.messages.appendChild(row);
  el.messages.scrollTop = el.messages.scrollHeight;
}

function setChatHeader() {
  if (state.mode === "room") {
    el.chatTitle.textContent = `# ${state.room}`;
    el.chatSub.textContent = "Oda sohbeti";
  } else {
    el.chatTitle.textContent = `DM · @${state.dmWith?.username || "-"}`;
    el.chatSub.textContent = "Özel mesaj";
  }
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

function userButtonLabel(u) {
  const unread = state.dmUnreadByUser.get(u.id) || 0;
  return unread > 0 ? `@${u.username} (${unread})` : `@${u.username}`;
}

function renderUsers() {
  const query = el.userSearch.value.trim().toLowerCase();
  const visible = state.users.filter((u) => u.username.toLowerCase().includes(query));
  el.userList.innerHTML = "";
  if (!visible.length) {
    el.userList.innerHTML = `<p class="muted">Kullanıcı bulunamadı.</p>`;
    return;
  }

  visible.forEach((u) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "chip";
    btn.textContent = userButtonLabel(u);
    btn.addEventListener("click", () => openUserModal(u));
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
  blocked.forEach((u) => {
    const row = document.createElement("div");
    row.className = "row";
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "chip";
    btn.textContent = `@${u.username}`;
    btn.addEventListener("click", () => openUserModal(u));
    row.appendChild(btn);
    el.blockedList.appendChild(row);
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
    username: (usernameInput || usernameDefault).trim().slice(0, 40),
    city: "",
    about: "",
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
    .single();
  if (error) throw error;
  state.profile = data;
  localStorage.setItem("alevichat_me", JSON.stringify(data));
}

async function loadUsers() {
  const { data, error } = await supabase
    .from("profiles")
    .select("id, username, city, about, role")
    .neq("id", state.me.id)
    .order("username");
  if (error) throw error;
  state.users = data || [];
}

async function loadBlocks() {
  state.blockedByMe.clear();
  state.blockedMe.clear();

  const { data: byMe, error: err1 } = await supabase
    .from("blocks")
    .select("blocked_user_id")
    .eq("user_id", state.me.id);
  if (err1) throw err1;
  (byMe || []).forEach((x) => state.blockedByMe.add(x.blocked_user_id));

  const { data: meBlockedBy, error: err2 } = await supabase
    .from("blocks")
    .select("user_id")
    .eq("blocked_user_id", state.me.id);
  if (err2) throw err2;
  (meBlockedBy || []).forEach((x) => state.blockedMe.add(x.user_id));
}

function canTalkTo(uid) {
  if (!uid) return false;
  if (state.blockedByMe.has(uid)) return false;
  if (state.blockedMe.has(uid)) return false;
  return true;
}

function openUserModal(user) {
  state.selectedUser = user;
  el.umTitle.textContent = `@${user.username}`;
  el.btnBlockUser.classList.toggle("hidden", state.blockedByMe.has(user.id));
  el.btnUnblockUser.classList.toggle("hidden", !state.blockedByMe.has(user.id));
  setNote(el.umNote, state.blockedMe.has(user.id) ? "Bu kullanıcı sizi engellemiş." : "");
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
    .limit(250);
  if (error) throw error;

  resetMessages();
  (data || []).forEach((m) => {
    if (state.blockedByMe.has(m.user_id) || state.blockedMe.has(m.user_id)) return;
    addMessageRow(m);
  });
}

async function loadDmHistory(otherUserId) {
  const me = state.me.id;
  const { data, error } = await supabase
    .from("dms")
    .select("id, from_user_id, to_user_id, message, created_at")
    .or(`and(from_user_id.eq.${me},to_user_id.eq.${otherUserId}),and(from_user_id.eq.${otherUserId},to_user_id.eq.${me})`)
    .order("id", { ascending: true })
    .limit(250);
  if (error) throw error;

  resetMessages();
  (data || []).forEach((m) => {
    const from = getUserById(m.from_user_id);
    addMessageRow({
      id: m.id,
      user_id: m.from_user_id,
      username: from?.username || "user",
      message: m.message,
      created_at: m.created_at,
    });
  });
}

function unsubscribeRoom() {
  if (state.roomChannel) {
    supabase.removeChannel(state.roomChannel);
    state.roomChannel = null;
  }
}

function subscribeRoom(room) {
  unsubscribeRoom();
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
        const m = payload.new;
        if (state.mode !== "room" || state.room !== room) return;
        if (state.blockedByMe.has(m.user_id) || state.blockedMe.has(m.user_id)) return;
        addMessageRow(m);
      }
    )
    .subscribe();
}

function unsubscribeDms() {
  if (state.dmInChannel) {
    supabase.removeChannel(state.dmInChannel);
    state.dmInChannel = null;
  }
  if (state.dmOutChannel) {
    supabase.removeChannel(state.dmOutChannel);
    state.dmOutChannel = null;
  }
}

function subscribeDms() {
  unsubscribeDms();
  const me = state.me.id;

  state.dmInChannel = supabase
    .channel(`dm-in-${me}`)
    .on(
      "postgres_changes",
      {
        event: "INSERT",
        schema: "public",
        table: "dms",
        filter: `to_user_id=eq.${me}`,
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
          });
        } else {
          const old = state.dmUnreadByUser.get(dm.from_user_id) || 0;
          state.dmUnreadByUser.set(dm.from_user_id, old + 1);
          renderUsers();
        }
      }
    )
    .subscribe();

  state.dmOutChannel = supabase
    .channel(`dm-out-${me}`)
    .on(
      "postgres_changes",
      {
        event: "INSERT",
        schema: "public",
        table: "dms",
        filter: `from_user_id=eq.${me}`,
      },
      (payload) => {
        const dm = payload.new;
        if (!(state.mode === "dm" && state.dmWith && dm.to_user_id === state.dmWith.id)) return;
        const from = getUserById(dm.from_user_id);
        addMessageRow({
          id: dm.id,
          user_id: dm.from_user_id,
          username: from?.username || state.profile.username,
          message: dm.message,
          created_at: dm.created_at,
        });
      }
    )
    .subscribe();
}

async function openRoom(room) {
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
    alert("Bu kullanıcıyla DM kapalı (engel).");
    return;
  }
  state.mode = "dm";
  state.dmWith = user;
  state.dmUnreadByUser.delete(user.id);
  renderUsers();
  setChatHeader();
  renderRooms();
  unsubscribeRoom();
  await loadDmHistory(user.id);
}

async function sendRoomMessage(text) {
  const payload = {
    user_id: state.me.id,
    username: state.profile.username,
    room: state.room,
    message: text,
  };
  const { error } = await supabase.from("messages").insert(payload);
  if (error) throw error;
}

async function sendDm(text) {
  if (!state.dmWith) throw new Error("DM seçilmedi.");
  if (!canTalkTo(state.dmWith.id)) throw new Error("DM engel nedeniyle kapalı.");
  const payload = {
    from_user_id: state.me.id,
    to_user_id: state.dmWith.id,
    message: text,
  };
  const { error } = await supabase.from("dms").insert(payload);
  if (error) throw error;
}

async function blockUser(uid) {
  const { error } = await supabase.from("blocks").insert({
    user_id: state.me.id,
    blocked_user_id: uid,
  });
  if (error && !String(error.message).includes("duplicate")) throw error;
}

async function unblockUser(uid) {
  const { error } = await supabase
    .from("blocks")
    .delete()
    .eq("user_id", state.me.id)
    .eq("blocked_user_id", uid);
  if (error) throw error;
}

async function reportUser(uid, reason) {
  const { error } = await supabase.from("reports").insert({
    reporter_id: state.me.id,
    target_user_id: uid,
    reason: reason.slice(0, 500),
  });
  if (error) throw error;
}

async function refreshPeoplePanels() {
  await loadUsers();
  await loadBlocks();
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
  subscribeDms();
  await openRoom(state.room);
}

async function restoreSession() {
  const { data, error } = await supabase.auth.getSession();
  if (error) throw error;
  const session = data.session;
  if (!session) {
    state.me = null;
    state.profile = null;
    toggleAuth(false);
    updateMeBadge();
    return;
  }
  state.me = session.user;
  await handlePostAuthSetup();
}

async function login(email, password) {
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw error;
  state.me = (await supabase.auth.getUser()).data.user;
  await handlePostAuthSetup();
}

async function signup(email, password, username) {
  const { data, error } = await supabase.auth.signUp({ email, password });
  if (error) throw error;
  if (!data.user) throw new Error("Kayıt başarısız.");

  await upsertProfileFromUser(data.user, username);
  state.me = data.user;
  await handlePostAuthSetup();
}

async function logout() {
  unsubscribeRoom();
  unsubscribeDms();
  await supabase.auth.signOut();
  state.me = null;
  state.profile = null;
  state.users = [];
  state.blockedByMe.clear();
  state.blockedMe.clear();
  state.dmUnreadByUser.clear();
  resetMessages();
  toggleAuth(false);
  updateMeBadge();
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
      if (state.authMode === "signup") {
        if (!username) throw new Error("Kayıt için kullanıcı adı gerekli.");
        await signup(email, password, username);
        setNote(el.authNote, "Kayıt başarılı.");
      } else {
        await login(email, password);
        setNote(el.authNote, "Giriş başarılı.");
      }
      el.authPassword.value = "";
    } catch (err) {
      setNote(el.authNote, err.message || "İşlem başarısız.", true);
    }
  });

  el.composer.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!state.me) return;
    const text = el.messageInput.value.trim();
    if (!text) return;
    el.messageInput.value = "";
    try {
      if (state.mode === "room") {
        await sendRoomMessage(text);
      } else {
        await sendDm(text);
      }
    } catch (err) {
      alert(err.message || "Mesaj gönderilemedi.");
    }
  });

  el.btnLogout.addEventListener("click", async () => {
    try {
      await logout();
    } catch (err) {
      alert(err.message || "Çıkış yapılamadı.");
    }
  });

  el.userSearch.addEventListener("input", () => renderUsers());

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
    } catch (err) {
      setNote(el.umNote, err.message || "Hata.", true);
    }
  });
  el.btnUnblockUser.addEventListener("click", async () => {
    if (!state.selectedUser) return;
    try {
      await unblockUser(state.selectedUser.id);
      await refreshPeoplePanels();
      openUserModal(state.selectedUser);
      setNote(el.umNote, "Engel kaldırıldı.");
    } catch (err) {
      setNote(el.umNote, err.message || "Hata.", true);
    }
  });
  el.btnReportUser.addEventListener("click", async () => {
    if (!state.selectedUser) return;
    const reason = prompt("Rapor nedeni:");
    if (!reason) return;
    try {
      await reportUser(state.selectedUser.id, reason);
      setNote(el.umNote, "Rapor gönderildi.");
    } catch (err) {
      setNote(el.umNote, err.message || "Rapor başarısız.", true);
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
        username: el.pfUsername.value.trim().slice(0, 40),
        city: el.pfCity.value.trim().slice(0, 80),
        about: el.pfAbout.value.trim().slice(0, 280),
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
    } catch (err) {
      setNote(el.pfNote, err.message || "Profil kaydedilemedi.", true);
    }
  });

  el.btnDmInbox.addEventListener("click", () => {
    if (!state.users.length) return;
    const best = state.users
      .slice()
      .sort((a, b) => (state.dmUnreadByUser.get(b.id) || 0) - (state.dmUnreadByUser.get(a.id) || 0))[0];
    if (best) openDmWith(best);
  });

  supabase.auth.onAuthStateChange(async (_event, session) => {
    if (!session) {
      await logout();
    }
  });
}

async function bootstrap() {
  wireEvents();
  renderRooms();
  renderUsers();
  renderBlocked();
  try {
    await restoreSession();
  } catch (err) {
    setNote(el.authNote, err.message || "Başlatma hatası.", true);
    toggleAuth(false);
  }
}

bootstrap();
