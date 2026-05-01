import { supabase } from "./supabaseClient.js";

const ROOMS = ["genel", "oyun", "sohbet"];

const state = {
  me: null,
  profile: null,
  mode: "room", // room | dm
  room: "genel",
  dmWith: null,
  roomChannel: null,
  dmChannel: null,
  loadedMessageIds: new Set(),
  activeAuthMode: "login",
};

const el = {
  roomList: document.getElementById("roomList"),
  userList: document.getElementById("userList"),
  chatTitle: document.getElementById("chatTitle"),
  chatSubtitle: document.getElementById("chatSubtitle"),
  meBadge: document.getElementById("meBadge"),
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
  messageForm: document.getElementById("messageForm"),
  messageInput: document.getElementById("messageInput"),
};

function resetMessages() {
  state.loadedMessageIds.clear();
  el.messages.innerHTML = "";
}

function escapeHtml(value) {
  const str = String(value ?? "");
  return str
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function formatTime(value) {
  const d = new Date(value);
  return d.toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit" });
}

function addMessageRow(msg, isMine) {
  if (!msg || !msg.id) return;
  if (state.loadedMessageIds.has(msg.id)) return;
  state.loadedMessageIds.add(msg.id);

  const row = document.createElement("div");
  row.className = "msg " + (isMine ? "msg--mine" : "");

  const from = msg.username || "user";
  row.innerHTML = `
    <div class="msg__meta">
      <strong>${escapeHtml(from)}</strong>
      <span>${formatTime(msg.created_at)}</span>
    </div>
    <div class="msg__text">${escapeHtml(msg.message)}</div>
  `;

  el.messages.appendChild(row);
  el.messages.scrollTop = el.messages.scrollHeight;
}

function setAuthNote(message, isError = false) {
  el.authNote.textContent = message;
  el.authNote.classList.toggle("note--error", isError);
}

function setMeBadge() {
  if (!state.profile) {
    el.meBadge.textContent = "Giriş yok";
    return;
  }
  el.meBadge.textContent = `${state.profile.username} (${state.me.email})`;
}

function setChatHeader() {
  if (state.mode === "room") {
    el.chatTitle.textContent = `# ${state.room}`;
    el.chatSubtitle.textContent = "Oda sohbeti";
  } else {
    el.chatTitle.textContent = `DM · ${state.dmWith.username}`;
    el.chatSubtitle.textContent = "Özel mesaj";
  }
}

function toggleAuthChat(isLoggedIn) {
  el.authCard.classList.toggle("hidden", isLoggedIn);
  el.chatCard.classList.toggle("hidden", !isLoggedIn);
  el.btnLogout.disabled = !isLoggedIn;
}

async function ensureProfile(user, fallbackUsername = "") {
  const username =
    fallbackUsername.trim() ||
    (user.email ? user.email.split("@")[0] : `user_${String(user.id).slice(0, 8)}`);

  const payload = {
    id: user.id,
    email: user.email || "",
    username,
  };

  const { data, error } = await supabase
    .from("profiles")
    .upsert(payload, { onConflict: "id" })
    .select("id, username, email")
    .single();

  if (error) throw error;
  return data;
}

async function loadUsersForDM() {
  if (!state.me) return;
  const { data, error } = await supabase
    .from("profiles")
    .select("id, username")
    .neq("id", state.me.id)
    .order("username", { ascending: true });
  if (error) throw error;

  el.userList.innerHTML = "";
  if (!data.length) {
    el.userList.innerHTML = `<p class="muted">Henüz başka kullanıcı yok.</p>`;
    return;
  }

  data.forEach((u) => {
    const btn = document.createElement("button");
    btn.className = "chip";
    btn.type = "button";
    btn.textContent = "@" + u.username;
    btn.addEventListener("click", () => openDM(u));
    el.userList.appendChild(btn);
  });
}

function renderRoomButtons() {
  el.roomList.innerHTML = "";
  ROOMS.forEach((room) => {
    const btn = document.createElement("button");
    btn.className = "chip " + (state.mode === "room" && state.room === room ? "chip--active" : "");
    btn.type = "button";
    btn.textContent = "# " + room;
    btn.addEventListener("click", () => openRoom(room));
    el.roomList.appendChild(btn);
  });
}

async function loadRoomMessages(room) {
  const { data, error } = await supabase
    .from("messages")
    .select("id, user_id, username, room, message, created_at")
    .eq("room", room)
    .order("created_at", { ascending: true })
    .limit(200);
  if (error) throw error;

  resetMessages();
  data.forEach((m) => addMessageRow(m, m.user_id === state.me.id));
}

async function loadDMMessages(otherUserId) {
  const meId = state.me.id;
  const { data, error } = await supabase
    .from("dm_messages")
    .select("id, from_user_id, to_user_id, message, created_at, from_username")
    .or(`and(from_user_id.eq.${meId},to_user_id.eq.${otherUserId}),and(from_user_id.eq.${otherUserId},to_user_id.eq.${meId})`)
    .order("created_at", { ascending: true })
    .limit(200);
  if (error) throw error;

  resetMessages();
  data.forEach((m) => {
    addMessageRow(
      {
        id: m.id,
        username: m.from_username,
        message: m.message,
        created_at: m.created_at,
      },
      m.from_user_id === meId
    );
  });
}

function unsubscribeRoomChannel() {
  if (state.roomChannel) {
    supabase.removeChannel(state.roomChannel);
    state.roomChannel = null;
  }
}

function subscribeRoomRealtime(room) {
  unsubscribeRoomChannel();
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
        addMessageRow(m, m.user_id === state.me.id);
      }
    )
    .subscribe();
}

function unsubscribeDMChannel() {
  if (state.dmChannel) {
    supabase.removeChannel(state.dmChannel);
    state.dmChannel = null;
  }
}

function subscribeDMRealtime() {
  unsubscribeDMChannel();
  const meId = state.me.id;
  state.dmChannel = supabase
    .channel(`dm-${meId}`)
    .on(
      "postgres_changes",
      {
        event: "INSERT",
        schema: "public",
        table: "dm_messages",
        filter: `to_user_id=eq.${meId}`,
      },
      (payload) => {
        const m = payload.new;
        if (state.mode !== "dm") return;
        if (!state.dmWith || m.from_user_id !== state.dmWith.id) return;
        addMessageRow(
          {
            id: m.id,
            username: m.from_username,
            message: m.message,
            created_at: m.created_at,
          },
          false
        );
      }
    )
    .subscribe();
}

async function openRoom(room) {
  state.mode = "room";
  state.room = room;
  state.dmWith = null;
  setChatHeader();
  renderRoomButtons();
  await loadRoomMessages(room);
  subscribeRoomRealtime(room);
}

async function openDM(user) {
  state.mode = "dm";
  state.dmWith = user;
  setChatHeader();
  renderRoomButtons();
  unsubscribeRoomChannel();
  await loadDMMessages(user.id);
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

async function sendDMMessage(text) {
  if (!state.dmWith) throw new Error("DM kullanıcı seçilmedi.");
  const payload = {
    from_user_id: state.me.id,
    to_user_id: state.dmWith.id,
    from_username: state.profile.username,
    message: text,
  };
  const { data, error } = await supabase.from("dm_messages").insert(payload).select().single();
  if (error) throw error;

  addMessageRow(
    {
      id: data.id,
      username: data.from_username,
      message: data.message,
      created_at: data.created_at,
    },
    true
  );
}

async function restoreSession() {
  const { data, error } = await supabase.auth.getSession();
  if (error) throw error;
  const session = data.session;
  if (!session) {
    state.me = null;
    state.profile = null;
    toggleAuthChat(false);
    setMeBadge();
    return;
  }
  state.me = session.user;

  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("id, username, email")
    .eq("id", state.me.id)
    .single();
  if (profileError) throw profileError;

  state.profile = profile;
  toggleAuthChat(true);
  setMeBadge();
  await loadUsersForDM();
  await openRoom(state.room);
  subscribeDMRealtime();
}

async function login(email, password) {
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw error;
  await restoreSession();
}

async function signup(email, password, username) {
  const { data, error } = await supabase.auth.signUp({ email, password });
  if (error) throw error;
  if (!data.user) throw new Error("Kullanıcı oluşturulamadı.");

  await ensureProfile(data.user, username);
  await restoreSession();
}

async function logout() {
  unsubscribeRoomChannel();
  unsubscribeDMChannel();
  await supabase.auth.signOut();
  state.me = null;
  state.profile = null;
  resetMessages();
  toggleAuthChat(false);
  setMeBadge();
  el.userList.innerHTML = "";
  renderRoomButtons();
}

function setupListeners() {
  el.btnLogin.addEventListener("click", () => {
    state.activeAuthMode = "login";
  });
  el.btnSignup.addEventListener("click", () => {
    state.activeAuthMode = "signup";
  });

  el.authForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const email = el.authEmail.value.trim();
    const password = el.authPassword.value.trim();
    const username = el.authUsername.value.trim();
    try {
      setAuthNote("");
      if (state.activeAuthMode === "signup") {
        await signup(email, password, username);
        setAuthNote("Kayıt başarılı. Giriş yapıldı.");
      } else {
        await login(email, password);
        setAuthNote("Giriş başarılı.");
      }
      el.authPassword.value = "";
    } catch (error) {
      setAuthNote(error.message || "İşlem başarısız.", true);
    }
  });

  el.messageForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!state.me) return;
    const text = el.messageInput.value.trim();
    if (!text) return;
    el.messageInput.value = "";
    try {
      if (state.mode === "room") {
        await sendRoomMessage(text);
      } else {
        await sendDMMessage(text);
      }
    } catch (error) {
      alert(error.message || "Mesaj gönderilemedi.");
    }
  });

  el.btnLogout.addEventListener("click", async () => {
    try {
      await logout();
    } catch (error) {
      alert(error.message || "Çıkış yapılamadı.");
    }
  });

  supabase.auth.onAuthStateChange(async (_event, session) => {
    if (!session) {
      await logout();
      return;
    }
  });
}

async function bootstrap() {
  renderRoomButtons();
  setupListeners();
  try {
    await restoreSession();
  } catch (error) {
    console.error(error);
    setAuthNote(error.message || "Başlangıç hatası", true);
    toggleAuthChat(false);
  }
}

bootstrap();
