const API_URL = "https://card-speed-match-online.umjunsick022.chatgpt.site/api/game";

const state = {
    token: localStorage.getItem("card-match-token") || "",
    user: null,
    mode: "login",
    queued: false,
    match: null,
    knownCards: [],
    pendingFlips: [],
    showResult: false,
    message: ""
};

const app = document.getElementById("app");
const chatWidget = document.getElementById("chatWidget");
const chatState = {
    open: false,
    query: "",
    results: [],
    target: null,
    messages: [],
    draft: "",
    error: ""
};

async function api(action, extra = {}) {
    const response = await fetch(API_URL, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            ...(state.token ? { Authorization: `Bearer ${state.token}` } : {})
        },
        body: JSON.stringify({ action, ...extra })
    });
    const text = await response.text();
    let data;
    try {
        data = JSON.parse(text);
    } catch {
        throw new Error("서버 연결에 실패했습니다.");
    }
    if (!response.ok) throw new Error(data.message || "요청에 실패했습니다.");
    return data;
}

function applyData(data) {
    state.user = data.user;
    state.queued = Boolean(data.queued);
    if (data.match) {
        if (state.match?.id !== data.match.id) {
            state.knownCards = [];
            state.pendingFlips = [];
        }
        data.match.cards.forEach((emoji, index) => {
            if (emoji) state.knownCards[index] = emoji;
        });
        state.match = data.match;
        if (data.match.status === "finished" && data.match.result) state.showResult = true;
    }
    render();
}

function renderAuth() {
    app.innerHTML = `
        <section class="auth">
            <div class="auth-inner">
                <h1>카드 짝 맞추기</h1>
                <p class="subtitle">친구보다 빨리 카드 8쌍을 맞춰보세요</p>
                <div class="tabs">
                    <button id="loginTab" class="${state.mode === "login" ? "" : "off"}">로그인</button>
                    <button id="signupTab" class="${state.mode === "signup" ? "" : "off"}">회원가입</button>
                </div>
                <form id="authForm">
                    <label>아이디<input name="username" minlength="3" maxlength="16" required></label>
                    <label>비밀번호<input name="password" type="password" minlength="4" maxlength="64" required></label>
                    <button type="submit">${state.mode === "login" ? "로그인" : "가입하기"}</button>
                </form>
                <p class="message">${state.message}</p>
            </div>
        </section>`;
    document.getElementById("loginTab").onclick = () => { state.mode = "login"; state.message = ""; render(); };
    document.getElementById("signupTab").onclick = () => { state.mode = "signup"; state.message = ""; render(); };
    document.getElementById("authForm").onsubmit = async (event) => {
        event.preventDefault();
        const form = new FormData(event.currentTarget);
        try {
            const data = await api(state.mode, { username: form.get("username"), password: form.get("password") });
            state.token = data.token;
            state.user = data.user;
            state.message = "";
            localStorage.setItem("card-match-token", state.token);
            render();
        } catch (error) {
            state.message = error.message;
            render();
        }
    };
}

function renderLobby() {
    app.innerHTML = `
        <header class="top"><h1>카드 짝 맞추기</h1><button id="logout">로그아웃</button></header>
        <section class="profile">
            <h2>${state.user.username} 님</h2>
            <div class="record"><span>승리 <b>${state.user.wins}</b></span><span>패배 <b>${state.user.losses}</b></span></div>
        </section>
        <section class="queue">
            <div class="queue-icon ${state.queued ? "spin" : ""}">${state.queued ? "↻" : "?"}</div>
            <h2>${state.queued ? "상대를 찾는 중..." : "대결 준비 완료"}</h2>
            <p>${state.queued ? "다른 플레이어가 들어올 때까지 기다려 주세요." : "버튼을 누르면 자동으로 1대1 매칭됩니다."}</p>
            <button id="queueButton">${state.queued ? "매칭 취소" : "큐 돌리기"}</button>
        </section>
        <p class="help">같은 주소에 접속한 다른 사람과 매칭됩니다.</p>`;
    document.getElementById("logout").onclick = logout;
    document.getElementById("queueButton").onclick = () => runAction(state.queued ? "cancelQueue" : "joinQueue");
}

function renderGame() {
    const match = state.match;
    const preview = Date.now() < match.startsAt;
    const seconds = preview ? Math.max(1, Math.ceil((match.startsAt - Date.now()) / 1000)) : Math.max(0, Math.ceil((match.endsAt - Date.now()) / 1000));
    app.innerHTML = `
        <h1>카드 짝 맞추기</h1>
        <section class="score">
            <div><b>나: ${match.player.username}</b><strong>${match.player.score}점</strong><small>실수 ${match.player.wrong}</small></div>
            <div class="vs">VS<br><span>${seconds}</span></div>
            <div><b>상대: ${match.opponent.username}</b><strong>${match.opponent.score}점</strong><small>실수 ${match.opponent.wrong}</small></div>
        </section>
        <p class="notice">${preview ? "카드를 외우세요" : "먼저 8쌍 맞추면 승리"}</p>
        <section class="board">
            ${match.cards.map((emoji, index) => {
                const matched = match.matched.includes(index);
                const wrong = match.wrongIndices.includes(index);
                const pending = state.pendingFlips.includes(index);
                const shownEmoji = emoji || (pending ? state.knownCards[index] : null);
                return `<button class="card ${shownEmoji ? "open" : ""} ${matched ? "matched" : ""} ${wrong ? "wrong" : ""}" data-index="${index}" ${preview || matched || shownEmoji ? "disabled" : ""}>${shownEmoji || "?"}</button>`;
            }).join("")}
        </section>
        <button id="leave" class="leave">게임 나가기</button>`;
    document.querySelectorAll(".card:not(:disabled)").forEach(card => {
        card.onclick = () => flipImmediately(Number(card.dataset.index));
    });
    document.getElementById("leave").onclick = () => {
        if (confirm("게임을 나가면 패배합니다. 나갈까요?")) runAction("leave", { matchId: match.id });
    };
}

let flipQueue = Promise.resolve();

function flipImmediately(index) {
    if (!state.match || state.pendingFlips.includes(index)) return;
    const visibleCount = state.match.cards.filter(Boolean).length + state.pendingFlips.length;
    if (visibleCount >= 2) return;

    state.pendingFlips.push(index);
    render();

    const matchId = state.match.id;
    flipQueue = flipQueue.then(async () => {
        const data = await api("flip", { matchId, index });
        state.pendingFlips = state.pendingFlips.filter(value => value !== index);
        applyData(data);
    }).catch(error => {
        state.pendingFlips = state.pendingFlips.filter(value => value !== index);
        state.message = error.message;
        render();
    });
}

function renderResult() {
    const match = state.match;
    const result = match.result === "win" ? ["🎉", "승리"] : match.result === "lose" ? ["ㅠㅠ", "패배"] : ["🤝", "무승부"];
    app.innerHTML = `<section class="result"><div class="result-icon">${result[0]}</div><h1>${result[1]}</h1><p>내 점수 ${match.player.score} : ${match.opponent.score} 상대 점수</p><button id="lobby">로비로 돌아가기</button></section>`;
    document.getElementById("lobby").onclick = () => { state.match = null; state.showResult = false; render(); };
}

function render() {
    if (!state.token || !state.user) renderAuth();
    else if (state.showResult && state.match?.result) renderResult();
    else if (state.match) renderGame();
    else renderLobby();
    syncChatVisibility();
}

function escapeHtml(value) {
    return String(value)
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#039;");
}

function syncChatVisibility() {
    if (!state.token || !state.user) {
        chatWidget.innerHTML = "";
        chatWidget.classList.add("hidden");
        return;
    }
    chatWidget.classList.remove("hidden");
    if (!chatWidget.innerHTML) renderChat();
}

function renderChat() {
    if (!state.token || !state.user) return syncChatVisibility();

    if (!chatState.open) {
        chatWidget.innerHTML = `<button id="openChat" class="chat-fab">채팅</button>`;
        document.getElementById("openChat").onclick = () => {
            chatState.open = true;
            renderChat();
        };
        return;
    }

    if (!chatState.target) {
        chatWidget.innerHTML = `
            <section class="chat-panel">
                <header class="chat-header"><b>아이디로 채팅</b><button id="closeChat" aria-label="채팅 닫기">×</button></header>
                <form id="userSearch" class="chat-search">
                    <input id="chatQuery" value="${escapeHtml(chatState.query)}" placeholder="상대 아이디 검색" maxlength="16" autocomplete="off">
                    <button type="submit">검색</button>
                </form>
                <div class="chat-results">
                    ${chatState.results.map(user => `<button class="chat-user" data-user-id="${user.id}">${escapeHtml(user.username)}</button>`).join("") || `<p>아이디를 검색해주세요.</p>`}
                </div>
                <p class="chat-error">${escapeHtml(chatState.error)}</p>
            </section>`;
        document.getElementById("closeChat").onclick = () => { chatState.open = false; renderChat(); };
        document.getElementById("userSearch").onsubmit = searchChatUsers;
        document.querySelectorAll(".chat-user").forEach(button => {
            button.onclick = () => openConversation(Number(button.dataset.userId));
        });
        return;
    }

    chatWidget.innerHTML = `
        <section class="chat-panel">
            <header class="chat-header">
                <button id="chatBack" aria-label="검색으로 돌아가기">←</button>
                <b>${escapeHtml(chatState.target.username)}</b>
                <button id="closeChat" aria-label="채팅 닫기">×</button>
            </header>
            <div id="chatMessages" class="chat-messages">
                ${chatState.messages.map(message => `
                    <div class="chat-message ${message.senderId === state.user.id ? "mine" : "theirs"}">
                        <span>${escapeHtml(message.body)}</span>
                    </div>`).join("") || `<p>첫 메시지를 보내보세요.</p>`}
            </div>
            <form id="messageForm" class="chat-compose">
                <input id="messageInput" value="${escapeHtml(chatState.draft)}" placeholder="메시지 입력" maxlength="300" autocomplete="off">
                <button type="submit">전송</button>
            </form>
            <p class="chat-error">${escapeHtml(chatState.error)}</p>
        </section>`;
    document.getElementById("closeChat").onclick = () => { chatState.open = false; renderChat(); };
    document.getElementById("chatBack").onclick = () => {
        chatState.target = null;
        chatState.messages = [];
        chatState.error = "";
        renderChat();
    };
    document.getElementById("messageInput").oninput = event => { chatState.draft = event.target.value; };
    document.getElementById("messageForm").onsubmit = sendChatMessage;
    const messages = document.getElementById("chatMessages");
    messages.scrollTop = messages.scrollHeight;
}

async function searchChatUsers(event) {
    event.preventDefault();
    chatState.query = document.getElementById("chatQuery").value.trim();
    chatState.error = "";
    try {
        const data = await api("searchUsers", { query: chatState.query });
        chatState.results = data.users;
    } catch (error) {
        chatState.error = error.message;
    }
    renderChat();
}

async function openConversation(targetId) {
    chatState.error = "";
    try {
        const data = await api("getMessages", { targetId });
        chatState.target = data.target;
        chatState.messages = data.messages;
        chatState.draft = "";
    } catch (error) {
        chatState.error = error.message;
    }
    renderChat();
}

async function sendChatMessage(event) {
    event.preventDefault();
    const message = chatState.draft.trim();
    if (!message || !chatState.target) return;
    chatState.draft = "";
    chatState.error = "";
    try {
        const data = await api("sendMessage", { targetId: chatState.target.id, message });
        chatState.messages = data.messages;
    } catch (error) {
        chatState.draft = message;
        chatState.error = error.message;
    }
    renderChat();
}

let chatPolling = false;
async function pollChat() {
    if (chatPolling || !state.token || !chatState.open || !chatState.target) return;
    chatPolling = true;
    try {
        const data = await api("getMessages", { targetId: chatState.target.id });
        const oldLast = chatState.messages.at(-1)?.id;
        const newLast = data.messages.at(-1)?.id;
        if (oldLast !== newLast || chatState.messages.length !== data.messages.length) {
            chatState.messages = data.messages;
            renderChat();
        }
    } catch (error) {
        chatState.error = error.message;
    } finally {
        chatPolling = false;
    }
}

async function runAction(action, extra = {}) {
    try { applyData(await api(action, extra)); }
    catch (error) { state.message = error.message; render(); }
}

async function logout() {
    try { await api("logout"); } catch {}
    localStorage.removeItem("card-match-token");
    state.token = "";
    state.user = null;
    state.match = null;
    chatState.open = false;
    chatState.target = null;
    chatState.messages = [];
    chatState.results = [];
    render();
}

async function poll() {
    if (!state.token || state.pendingFlips.length > 0) return;
    try {
        const data = await api("poll", state.match ? { matchId: state.match.id } : {});
        applyData(data);
    } catch (error) {
        if (error.message.includes("로그인")) logout();
    }
}

render();
poll();
setInterval(poll, 300);
setInterval(() => { if (state.match && !state.showResult) render(); }, 250);
setInterval(pollChat, 1000);
