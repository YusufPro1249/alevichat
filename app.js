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

  // =====================
  // ✅ SCROLL FIX STATE
  // =====================
  autoScroll: true,
  isUserScrolling: false,
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
};

/* =========================
   🔥 SCROLL FIX (GERÇEK FIX)
========================= */

function updateAutoScrollState() {
  const elMsg = el.messages;
  const distance =
    elMsg.scrollHeight - elMsg.scrollTop - elMsg.clientHeight;

  state.autoScroll = distance < 120;
}

el.messages.addEventListener("scroll", () => {
  updateAutoScrollState();
});

/* =========================
   SCROLL TO BOTTOM FIX
========================= */

function scrollToBottom(force = false) {
  requestAnimationFrame(() => {
    if (state.autoScroll || force) {
      el.messages.scrollTop = el.messages.scrollHeight;
    }
  });
}

/* =========================
   MESSAGE RENDER
========================= */

function addMessageRow({
  id,
  user_id,
  username,
  message,
  created_at,
  modeKey,
}) {
  if (!id) return;

  const dedupe = `${modeKey}:${id}`;
  if (state.renderedIds.has(dedupe)) return;
  state.renderedIds.add(dedupe);

  const row = document.createElement("article");
  row.className = `msg ${
    state.me && user_id === state.me.id ? "msg--mine" : ""
  }`;

  row.innerHTML = `
    <div class="msg__meta">
      <div class="msg__user">
        <button class="msg__name" type="button">
          ${username || "user"}
        </button>
      </div>
      <span>${new Date(created_at).toLocaleTimeString("tr-TR", {
        hour: "2-digit",
        minute: "2-digit",
      })}</span>
    </div>
    <div class="msg__text">${message}</div>
  `;

  el.messages.appendChild(row);

  scrollToBottom();
}

/* =========================
   LOAD ROOM
========================= */

async function loadRoomHistory(room) {
  const { data } = await supabase
    .from("messages")
    .select("*")
    .eq("room", room)
    .order("id", { ascending: true })
    .limit(300);

  el.messages.innerHTML = "";
  state.renderedIds.clear();

  for (const row of data || []) {
    addMessageRow({ ...row, modeKey: "room" });
  }

  state.autoScroll = true;
  scrollToBottom(true);
}

/* =========================
   LOAD DM
========================= */

async function loadDmHistory(otherId) {
  const me = state.me.id;

  const { data } = await supabase
    .from("dms")
    .select("*")
    .or(
      `and(from_user_id.eq.${me},to_user_id.eq.${otherId}),and(from_user_id.eq.${otherId},to_user_id.eq.${me})`
    )
    .order("id", { ascending: true })
    .limit(300);

  el.messages.innerHTML = "";
  state.renderedIds.clear();

  for (const row of data || []) {
    addMessageRow({ ...row, modeKey: "dm" });
  }

  state.autoScroll = true;
  scrollToBottom(true);
}

/* =========================
   REALTIME
========================= */

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
        addMessageRow({ ...payload.new, modeKey: "room" });
      }
    )
    .subscribe();
}

/* =========================
   SEND MESSAGE
========================= */

async function sendRoomMessage(text) {
  const clean = text.trim().slice(0, MAX_MESSAGE_LENGTH);
  if (!clean) return;

  await supabase.from("messages").insert({
    user_id: state.me.id,
    username: state.profile.username,
    room: state.room,
    message: clean,
  });
}

/* =========================
   INIT
========================= */

function initScrollFix() {
  state.autoScroll = true;

  el.messages.addEventListener("scroll", () => {
    updateAutoScrollState();
  });
}

initScrollFix();
