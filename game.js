/**
 * game.js — мини-игра «Динозаврик»
 * Без картинок, без фреймворков: рисуем всё на canvas.
 * Работает в file:// и не засоряет глобальную область видимости (IIFE).
 */
(function () {
  "use strict";

  var canvas = document.getElementById("dino-canvas");
  if (!canvas) return;
  var ctx = canvas.getContext("2d");

  var startBtn = document.getElementById("game-start");
  var restartBtn = document.getElementById("game-restart");
  var jumpBtn = document.getElementById("game-jump");
  var scoreEl = document.getElementById("game-score");
  var bestEl = document.getElementById("game-best");
  var statusEl = document.getElementById("game-status");

  var STORAGE_KEY = "dino-best-v1";

  // ——— Настройки игры ———
  var W = 800;
  var H = 240;
  var GROUND_Y = 190;

  var running = false;
  var gameOver = false;
  var lastTs = 0;

  var speed = 260; // px/sec
  var gravity = 1400; // px/sec^2
  var jumpV = 520; // px/sec

  var score = 0;
  var best = 0;

  var dino = {
    x: 90,
    y: GROUND_Y,
    w: 34,
    h: 44,
    vy: 0,
    onGround: true
  };

  var obstacles = [];
  var spawnTimer = 0;
  var nextSpawn = 0.9;

  function clamp(n, a, b) {
    return Math.max(a, Math.min(b, n));
  }

  function loadBest() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      var n = raw ? parseInt(raw, 10) : 0;
      return Number.isFinite(n) ? n : 0;
    } catch (e) {
      return 0;
    }
  }

  function saveBest(n) {
    try {
      localStorage.setItem(STORAGE_KEY, String(n));
    } catch (e) {
      /* ignore */
    }
  }

  function setStatus(text) {
    if (!statusEl) return;
    statusEl.textContent = text || "";
  }

  // Адаптив: масштабируем canvas по размеру контейнера, сохраняя чёткость
  function resizeCanvas() {
    var rect = canvas.getBoundingClientRect();
    var cssW = Math.max(320, Math.floor(rect.width));
    var cssH = Math.floor(cssW * (H / W));
    cssH = clamp(cssH, 180, 320);

    canvas.style.height = cssH + "px";
    canvas.style.width = cssW + "px";

    var dpr = Math.max(1, Math.min(2, globalThis.devicePixelRatio || 1));
    canvas.width = Math.floor(cssW * dpr);
    canvas.height = Math.floor(cssH * dpr);

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function reset() {
    running = false;
    gameOver = false;
    lastTs = 0;

    speed = 260;
    score = 0;
    spawnTimer = 0;
    nextSpawn = 0.8 + Math.random() * 0.6;
    obstacles = [];

    dino.y = GROUND_Y;
    dino.vy = 0;
    dino.onGround = true;

    scoreEl.textContent = "0";
    setStatus("Нажми «Старт» или прыгни, чтобы начать.");

    if (startBtn) startBtn.hidden = false;
    if (restartBtn) restartBtn.hidden = true;
  }

  function start() {
    if (running) return;
    running = true;
    gameOver = false;
    setStatus("");
    if (startBtn) startBtn.hidden = true;
    if (restartBtn) restartBtn.hidden = true;
    requestAnimationFrame(loop);
  }

  function endGame() {
    running = false;
    gameOver = true;
    if (restartBtn) restartBtn.hidden = false;
    setStatus("Проигрыш! Нажми «Заново» или пробел, чтобы начать снова.");
    if (score > best) {
      best = score;
      bestEl.textContent = String(best);
      saveBest(best);
    }
  }

  function jump() {
    if (gameOver) {
      reset();
      start();
      dino.vy = -jumpV;
      dino.onGround = false;
      return;
    }
    if (!running) start();
    if (dino.onGround) {
      dino.vy = -jumpV;
      dino.onGround = false;
    }
  }

  function spawnObstacle() {
    // Несколько вариантов кактусов
    var kind = Math.random();
    var w = kind < 0.5 ? 18 : kind < 0.85 ? 26 : 36;
    var h = kind < 0.5 ? 42 : kind < 0.85 ? 32 : 50;
    obstacles.push({
      x: W + 40,
      y: GROUND_Y,
      w: w,
      h: h
    });
  }

  function rectsIntersect(a, b) {
    return (
      a.x < b.x + b.w &&
      a.x + a.w > b.x &&
      a.y - a.h < b.y &&
      a.y > b.y - b.h
    );
  }

  function update(dt) {
    // Физика динозаврика
    dino.vy += gravity * dt;
    dino.y += dino.vy * dt;
    if (dino.y >= GROUND_Y) {
      dino.y = GROUND_Y;
      dino.vy = 0;
      dino.onGround = true;
    }

    // Спавн препятствий
    spawnTimer += dt;
    if (spawnTimer >= nextSpawn) {
      spawnTimer = 0;
      nextSpawn = 0.7 + Math.random() * 0.8;
      spawnObstacle();
    }

    // Движение препятствий
    var dx = speed * dt;
    for (var i = 0; i < obstacles.length; i++) {
      obstacles[i].x -= dx;
    }
    // Удаляем ушедшие за экран
    obstacles = obstacles.filter(function (o) { return o.x + o.w > -20; });

    // Ускоряем игру со временем
    speed = Math.min(520, speed + 8 * dt);

    // Счёт
    score += Math.floor(60 * dt);
    scoreEl.textContent = String(score);

    // Коллизии
    var dRect = { x: dino.x, y: dino.y, w: dino.w, h: dino.h };
    for (var j = 0; j < obstacles.length; j++) {
      var o = obstacles[j];
      var oRect = { x: o.x, y: o.y, w: o.w, h: o.h };
      if (rectsIntersect(dRect, oRect)) {
        endGame();
        break;
      }
    }
  }

  function draw() {
    // Рисуем в «логических» координатах W×H (масштабируем в зависимости от canvas CSS)
    var rect = canvas.getBoundingClientRect();
    var scaleX = rect.width / W;
    var scaleY = rect.height / H;

    ctx.save();
    ctx.scale(scaleX, scaleY);

    // Фон
    ctx.clearRect(0, 0, W, H);

    // Земля
    ctx.strokeStyle = "rgba(255,255,255,0.22)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, GROUND_Y + 2);
    ctx.lineTo(W, GROUND_Y + 2);
    ctx.stroke();

    // Облака (простые декоративные кружки)
    ctx.fillStyle = "rgba(255,255,255,0.08)";
    for (var i = 0; i < 4; i++) {
      var x = (i * 210 + (score % 210)) % (W + 80) - 40;
      var y = 50 + i * 12;
      ctx.beginPath();
      ctx.arc(x, y, 16, 0, Math.PI * 2);
      ctx.arc(x + 18, y + 4, 14, 0, Math.PI * 2);
      ctx.arc(x + 34, y, 18, 0, Math.PI * 2);
      ctx.fill();
    }

    // Препятствия
    ctx.fillStyle = "rgba(52, 211, 153, 0.9)";
    ctx.strokeStyle = "rgba(255,255,255,0.16)";
    for (var j = 0; j < obstacles.length; j++) {
      var o = obstacles[j];
      // кактус: прямоугольник + «ветка»
      ctx.fillRect(o.x, o.y - o.h, o.w, o.h);
      ctx.strokeRect(o.x, o.y - o.h, o.w, o.h);

      var armW = Math.max(6, Math.floor(o.w * 0.35));
      var armH = Math.max(10, Math.floor(o.h * 0.45));
      ctx.fillRect(o.x + Math.floor(o.w * 0.2), o.y - Math.floor(o.h * 0.65), armW, armH);
    }

    // Динозаврик (милый «пиксельный» прямоугольник)
    ctx.fillStyle = "rgba(129, 140, 248, 0.95)";
    ctx.strokeStyle = "rgba(255,255,255,0.22)";
    ctx.lineWidth = 2;
    ctx.fillRect(dino.x, dino.y - dino.h, dino.w, dino.h);
    ctx.strokeRect(dino.x, dino.y - dino.h, dino.w, dino.h);

    // Глаз
    ctx.fillStyle = "rgba(15,23,42,0.95)";
    ctx.fillRect(dino.x + dino.w - 10, dino.y - dino.h + 10, 4, 4);

    // Нос
    ctx.fillStyle = "rgba(255,255,255,0.18)";
    ctx.fillRect(dino.x + dino.w - 6, dino.y - dino.h + 18, 3, 3);

    // Подсказка поверх, если не запущено
    if (!running && !gameOver) {
      ctx.fillStyle = "rgba(241,245,249,0.75)";
      ctx.font = "700 18px Nunito, system-ui, sans-serif";
      ctx.fillText("Нажми пробел / ↑ / клик, чтобы прыгнуть", 165, 120);
    }

    if (gameOver) {
      ctx.fillStyle = "rgba(15,23,42,0.65)";
      ctx.fillRect(0, 0, W, H);
      ctx.fillStyle = "rgba(241,245,249,0.92)";
      ctx.font = "900 28px Nunito, system-ui, sans-serif";
      ctx.fillText("Проигрыш!", 320, 105);
      ctx.font = "800 18px Nunito, system-ui, sans-serif";
      ctx.fillText("Нажми «Заново» или пробел", 265, 135);
    }

    ctx.restore();
  }

  function loop(ts) {
    if (!running) {
      draw();
      return;
    }

    if (!lastTs) lastTs = ts;
    var dt = (ts - lastTs) / 1000;
    lastTs = ts;
    dt = clamp(dt, 0, 0.033);

    update(dt);
    draw();

    if (running) requestAnimationFrame(loop);
  }

  function onKeyDown(e) {
    // Не мешаем вводу в поля формы
    var tag = (e.target && e.target.tagName) ? e.target.tagName.toLowerCase() : "";
    if (tag === "input" || tag === "textarea") return;

    if (e.code === "Space" || e.code === "ArrowUp") {
      e.preventDefault();
      jump();
    }
  }

  function onPointer() {
    jump();
  }

  // Инициализация
  best = loadBest();
  bestEl.textContent = String(best);
  resizeCanvas();
  reset();
  draw();

  window.addEventListener("resize", function () {
    resizeCanvas();
    draw();
  });

  document.addEventListener("keydown", onKeyDown);
  canvas.addEventListener("pointerdown", onPointer);
  if (jumpBtn) jumpBtn.addEventListener("click", onPointer);
  if (startBtn) startBtn.addEventListener("click", start);
  if (restartBtn) restartBtn.addEventListener("click", function () {
    reset();
    start();
  });
})();

