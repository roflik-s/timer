/**
 * app.js — основная логика таймера
 * IIFE: весь код изолирован, наружу не выходят лишние переменные.
 */
(function (global) {
  "use strict";

  var Data = global.CountdownSiteData;
  if (!Data) {
    console.error("Не загружен data.js");
    return;
  }

  // ——— Ссылки на элементы страницы ———
  var form = document.getElementById("event-form");
  var customFields = document.getElementById("custom-fields");
  var birthdayField = document.getElementById("birthday-field");
  var customNameInput = document.getElementById("custom-name");
  var customDateInput = document.getElementById("custom-date");
  var birthdayDateInput = document.getElementById("birthday-date");
  var eventNameEl = document.getElementById("timer-title");
  var eventDateDisplay = document.getElementById("event-date-display");
  var pastMessage = document.getElementById("past-message");
  var daysEl = document.getElementById("days");
  var hoursEl = document.getElementById("hours");
  var minutesEl = document.getElementById("minutes");
  var secondsEl = document.getElementById("seconds");
  var factText = document.getElementById("fact-text");
  var quoteText = document.getElementById("quote-text");
  var quoteAuthor = document.getElementById("quote-author");
  var dayImageVisual = document.getElementById("day-image-visual");
  var dayImageCaption = document.getElementById("day-image-caption");
  var eventsListEl = document.getElementById("events-list");
  var eventsEmptyEl = document.getElementById("events-empty");
  var clearEventsBtn = document.getElementById("clear-events");

  /**
   * Состояние приложения:
   * - events: список событий
   * - mainId: id главного события (показывается большим таймером)
   */
  var state = {
    events: [],
    mainId: null
  };

  /** ID интервала обновления таймеров */
  var timerInterval = null;

  // ——— Вспомогательные функции ———

  /**
   * Псевдослучайное число по дню года (один и тот же факт весь день)
   * @param {number} max — верхняя граница (не включая)
   */
  function dailyIndex(max) {
    var now = new Date();
    var start = new Date(now.getFullYear(), 0, 0);
    var dayOfYear = Math.floor((now - start) / 86400000);
    var seed = now.getFullYear() * 366 + dayOfYear;
    return seed % max;
  }

  /**
   * Форматирование даты для отображения по-русски.
   * Если передан timeZone, то дата выводится именно для этого часового пояса
   * (важно для «каникул по Черногории», если компьютер в другой зоне).
   */
  function formatDateRu(date, timeZone) {
    var opts = { day: "numeric", month: "long", year: "numeric" };
    if (timeZone) opts.timeZone = timeZone;
    return date.toLocaleDateString("ru-RU", opts);
  }

  /** Двузначное число для таймера */
  function pad2(n) {
    return n < 10 ? "0" + n : String(n);
  }

  // Часовой пояс Черногории (Подгорица). Используем его для «каникул».
  var MONTENEGRO_TZ = "Europe/Podgorica";

  /**
   * Получить составные части даты/времени в конкретной зоне.
   * @returns {{year:number, month:number, day:number, hour:number, minute:number, second:number}}
   */
  function getZonedParts(timeZone, date) {
    // en-CA удобно даёт 2-значные month/day и 24-часовой формат
    var dtf = new Intl.DateTimeFormat("en-CA", {
      timeZone: timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false
    });
    var parts = dtf.formatToParts(date);
    var out = {};
    for (var i = 0; i < parts.length; i++) {
      var p = parts[i];
      if (p.type !== "literal") out[p.type] = p.value;
    }
    return {
      year: parseInt(out.year, 10),
      month: parseInt(out.month, 10),
      day: parseInt(out.day, 10),
      hour: parseInt(out.hour, 10),
      minute: parseInt(out.minute, 10),
      second: parseInt(out.second, 10)
    };
  }

  /**
   * Создать Date для «полночь (00:00) указанного дня» в выбранной зоне.
   * Возвращает точный момент времени (timestamp), который соответствует этой полуночи в timeZone.
   * Работает без библиотек и корректно учитывает летнее время.
   */
  function makeZonedMidnightDate(timeZone, year, monthIndex, day) {
    // Начальное приближение: полночь UTC в тот же день
    var utcMs = Date.UTC(year, monthIndex, day, 0, 0, 0, 0);

    // 2 итерации обычно достаточно, чтобы попасть точно, даже при переходах DST
    for (var i = 0; i < 2; i++) {
      var parts = getZonedParts(timeZone, new Date(utcMs));
      // Превращаем «то, что показывает зона» в псевдо-UTC момент
      var asIfUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second, 0);
      var desiredAsIfUtc = Date.UTC(year, monthIndex, day, 0, 0, 0, 0);
      utcMs += desiredAsIfUtc - asIfUtc;
    }

    return new Date(utcMs);
  }

  /** Простая генерация id (достаточно для школьного проекта) */
  function makeId() {
    return "e_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 8);
  }

  /** Следующая дата для события «день рождения» (ближайший ДР в будущем) */
  function nextBirthdayDate(birthDateStr) {
    var parts = birthDateStr.split("-");
    var month = parseInt(parts[1], 10) - 1;
    var day = parseInt(parts[2], 10);
    var now = new Date();
    var year = now.getFullYear();
    var candidate = new Date(year, month, day, 0, 0, 0, 0);
    if (candidate <= now) {
      candidate = new Date(year + 1, month, day, 0, 0, 0, 0);
    }
    return candidate;
  }

  /**
   * Дата ближайших летних каникул.
   * ВАЖНО: рассчитывается по часовому поясу Черногории (Europe/Podgorica),
   * чтобы таймер был «как в регионе Черногории», даже если компьютер в другой зоне.
   *
   * Сейчас старт поставлен на 1 июня (как было раньше).
   * Если тебе нужно другое число (например, 15 июня), скажи — поменяю в одной строке.
   */
  function nextVacationDate() {
    var nowMs = Date.now();
    var nowInMe = getZonedParts(MONTENEGRO_TZ, new Date(nowMs));
    var year = nowInMe.year;

    var startMonthIndex = 5; // Июнь
    var startDay = 1; // 1 июня (можно изменить при необходимости)

    var juneFirstMe = makeZonedMidnightDate(MONTENEGRO_TZ, year, startMonthIndex, startDay);
    if (juneFirstMe.getTime() <= nowMs) {
      juneFirstMe = makeZonedMidnightDate(MONTENEGRO_TZ, year + 1, startMonthIndex, startDay);
    }
    return juneFirstMe;
  }

  /** Дата ближайшего Нового года (1 января) */
  function nextNewYearDate() {
    var now = new Date();
    var year = now.getFullYear();
    var janFirst = new Date(year, 0, 1, 0, 0, 0, 0);
    if (janFirst <= now) {
      janFirst = new Date(year + 1, 0, 1, 0, 0, 0, 0);
    }
    return janFirst;
  }

  /**
   * Следующая дата фиксированного праздника в локальной зоне компьютера
   * (00:00 указанного дня). Например: 8 марта, 1 сентября, 31 октября.
   */
  function nextFixedLocalDate(monthIndex, day) {
    var now = new Date();
    var year = now.getFullYear();
    var d = new Date(year, monthIndex, day, 0, 0, 0, 0);
    if (d <= now) d = new Date(year + 1, monthIndex, day, 0, 0, 0, 0);
    return d;
  }

  /**
   * Следующая дата фиксированного праздника по зоне Черногории (Podgorica)
   * (00:00 указанного дня в этой зоне).
   */
  function nextFixedMontenegroDate(monthIndex, day) {
    var nowMs = Date.now();
    var nowInMe = getZonedParts(MONTENEGRO_TZ, new Date(nowMs));
    var year = nowInMe.year;
    var d = makeZonedMidnightDate(MONTENEGRO_TZ, year, monthIndex, day);
    if (d.getTime() <= nowMs) d = makeZonedMidnightDate(MONTENEGRO_TZ, year + 1, monthIndex, day);
    return d;
  }

  /** Применить CSS-класс темы к body */
  function applyTheme(type) {
    document.body.className = "theme-" + (type || "custom");
  }

  /** Показать/скрыть дополнительные поля формы */
  function updateFormFields() {
    var selected = form.querySelector('input[name="event-type"]:checked');
    var type = selected ? selected.value : "";
    customFields.hidden = type !== "custom";
    birthdayField.hidden = type !== "birthday";
  }

  /** Загрузить состояние из localStorage (поддержка старого формата) */
  function loadFromStorage() {
    try {
      var raw = localStorage.getItem(Data.STORAGE_KEY);
      if (!raw) return null;
      var parsed = JSON.parse(raw);

      // Новый формат: { events: [...], mainId: "..." }
      if (parsed && Array.isArray(parsed.events)) return parsed;

      // Старый формат (одиночное событие): превратим в список
      if (parsed && parsed.targetISO && parsed.name && parsed.type) {
        return {
          events: [
            {
              id: makeId(),
              type: parsed.type,
              name: parsed.name,
              targetISO: parsed.targetISO,
              extraDate: parsed.extraDate || null,
              createdAt: Date.now()
            }
          ],
          mainId: null
        };
      }

      return null;
    } catch (e) {
      return null;
    }
  }

  /** Сохранить состояние в localStorage */
  function saveToStorage(storageState) {
    try {
      localStorage.setItem(Data.STORAGE_KEY, JSON.stringify(storageState));
    } catch (e) {
      /* localStorage может быть недоступен — сайт всё равно работает */
    }
  }

  /** Собрать объект события из формы */
  function buildEventFromForm() {
    var selected = form.querySelector('input[name="event-type"]:checked');
    if (!selected) return null;

    var type = selected.value;
    var name;
    var targetDate;

    // Быстрые пресеты с фиксированным днём/месяцем
    if (type === "christmas") {
      name = Data.PRESET_NAMES.christmas || "Рождество";
      // Черногория: 25 декабря
      targetDate = nextFixedMontenegroDate(11, 25);
      return { id: makeId(), type: type, name: name, targetISO: targetDate.toISOString(), extraDate: null, createdAt: Date.now(), timeZone: MONTENEGRO_TZ };
    }
    if (type === "valentine") {
      name = Data.PRESET_NAMES.valentine || "14 февраля";
      targetDate = nextFixedLocalDate(1, 14);
      return { id: makeId(), type: type, name: name, targetISO: targetDate.toISOString(), extraDate: null, createdAt: Date.now() };
    }
    if (type === "march8") {
      name = Data.PRESET_NAMES.march8 || "8 марта";
      targetDate = nextFixedLocalDate(2, 8);
      return { id: makeId(), type: type, name: name, targetISO: targetDate.toISOString(), extraDate: null, createdAt: Date.now() };
    }
    if (type === "may9") {
      name = Data.PRESET_NAMES.may9 || "9 мая";
      targetDate = nextFixedLocalDate(4, 9);
      return { id: makeId(), type: type, name: name, targetISO: targetDate.toISOString(), extraDate: null, createdAt: Date.now() };
    }
    if (type === "school") {
      name = Data.PRESET_NAMES.school || "1 сентября";
      targetDate = nextFixedLocalDate(8, 1);
      return { id: makeId(), type: type, name: name, targetISO: targetDate.toISOString(), extraDate: null, createdAt: Date.now() };
    }
    if (type === "halloween") {
      name = Data.PRESET_NAMES.halloween || "Хэллоуин";
      targetDate = nextFixedLocalDate(9, 31);
      return { id: makeId(), type: type, name: name, targetISO: targetDate.toISOString(), extraDate: null, createdAt: Date.now() };
    }

    if (type === "birthday") {
      if (!birthdayDateInput.value) return { error: "Укажи дату дня рождения." };
      name = Data.PRESET_NAMES.birthday;
      targetDate = nextBirthdayDate(birthdayDateInput.value);
      return {
        id: makeId(),
        type: type,
        name: name,
        targetISO: targetDate.toISOString(),
        extraDate: birthdayDateInput.value,
        createdAt: Date.now()
      };
    }

    if (type === "vacation") {
      targetDate = nextVacationDate();
      return {
        id: makeId(),
        type: type,
        name: Data.PRESET_NAMES.vacation,
        targetISO: targetDate.toISOString(),
        extraDate: null,
        createdAt: Date.now()
      };
    }

    if (type === "newyear") {
      targetDate = nextNewYearDate();
      return {
        id: makeId(),
        type: type,
        name: Data.PRESET_NAMES.newyear,
        targetISO: targetDate.toISOString(),
        extraDate: null,
        createdAt: Date.now()
      };
    }

    if (type === "custom") {
      var customName = customNameInput.value.trim();
      if (!customName) return { error: "Введи название своего события." };
      if (!customDateInput.value) return { error: "Выбери дату события." };
      var customParts = customDateInput.value.split("-");
      targetDate = new Date(
        parseInt(customParts[0], 10),
        parseInt(customParts[1], 10) - 1,
        parseInt(customParts[2], 10),
        0, 0, 0, 0
      );
      return {
        id: makeId(),
        type: type,
        name: customName,
        targetISO: targetDate.toISOString(),
        extraDate: customDateInput.value,
        createdAt: Date.now()
      };
    }

    return null;
  }

  /** Заполнить форму из сохранённого события */
  function fillFormFromEvent(ev) {
    var radio = form.querySelector('input[name="event-type"][value="' + ev.type + '"]');
    if (radio) radio.checked = true;
    if (ev.type === "birthday" && ev.extraDate) {
      birthdayDateInput.value = ev.extraDate;
    }
    if (ev.type === "custom") {
      customNameInput.value = ev.name;
      if (ev.extraDate) customDateInput.value = ev.extraDate;
    }
    updateFormFields();
  }

  /** Обновить блоки «факт», «цитата», «картинка» */
  function updateDailyBlocks(eventType) {
    var factIdx = dailyIndex(Data.FACTS.length);
    var quoteIdx = dailyIndex(Data.QUOTES.length);
    var imageIdx = dailyIndex(Data.IMAGE_THEMES.length);

    factText.textContent = Data.FACTS[factIdx];

    var quote = Data.QUOTES[quoteIdx];
    quoteText.textContent = "«" + quote.text + "»";
    quoteAuthor.textContent = quote.author ? "— " + quote.author : "";

    var theme = Data.IMAGE_THEMES[imageIdx];
    dayImageVisual.style.backgroundImage = theme.gradient;
    dayImageVisual.style.backgroundColor = "";

    var caption = Data.EVENT_IMAGE_CAPTIONS[eventType] || theme.caption;
    dayImageCaption.textContent = caption + " · " + theme.caption;
  }

  /** Анимация «тика» при смене секунд */
  function animateTick(el) {
    el.classList.remove("tick");
    void el.offsetWidth;
    el.classList.add("tick");
  }

  /**
   * Посчитать остаток времени до даты.
   * @returns {{isPast:boolean, days:number, hours:number, minutes:number, seconds:number}}
   */
  function getCountdownParts(targetISO) {
    var target = new Date(targetISO);
    var now = new Date();
    var diff = target - now;
    if (diff <= 0) {
      return { isPast: true, days: 0, hours: 0, minutes: 0, seconds: 0 };
    }

    var totalSeconds = Math.floor(diff / 1000);
    var days = Math.floor(totalSeconds / 86400);
    var hours = Math.floor((totalSeconds % 86400) / 3600);
    var minutes = Math.floor((totalSeconds % 3600) / 60);
    var seconds = totalSeconds % 60;
    return { isPast: false, days: days, hours: hours, minutes: minutes, seconds: seconds };
  }

  /** Обновить большой таймер (главное событие) */
  function updateMainCountdown() {
    var main = getMainEvent();
    if (!main) return;

    var parts = getCountdownParts(main.targetISO);
    if (parts.isPast) {
      pastMessage.hidden = false;
      daysEl.textContent = "00";
      hoursEl.textContent = "00";
      minutesEl.textContent = "00";
      secondsEl.textContent = "00";
      return;
    }

    pastMessage.hidden = true;

    if (daysEl.textContent !== pad2(parts.days)) daysEl.textContent = pad2(parts.days);
    if (hoursEl.textContent !== pad2(parts.hours)) hoursEl.textContent = pad2(parts.hours);
    if (minutesEl.textContent !== pad2(parts.minutes)) minutesEl.textContent = pad2(parts.minutes);
    if (secondsEl.textContent !== pad2(parts.seconds)) {
      secondsEl.textContent = pad2(parts.seconds);
      animateTick(secondsEl);
    }
  }

  /** Обновить мини-таймеры в списке */
  function updateListCountdowns() {
    if (!eventsListEl) return;
    var nodes = eventsListEl.querySelectorAll("[data-event-id]");
    for (var i = 0; i < nodes.length; i++) {
      var card = nodes[i];
      var id = card.getAttribute("data-event-id");
      var ev = findEventById(id);
      if (!ev) continue;

      var parts = getCountdownParts(ev.targetISO);
      var statusEl = card.querySelector(".event-item__status");
      var mini = card.querySelector(".mini-countdown");

      if (parts.isPast) {
        if (mini) mini.hidden = true;
        if (statusEl) statusEl.hidden = false;
      } else {
        if (statusEl) statusEl.hidden = true;
        if (mini) mini.hidden = false;
        card.querySelector("[data-k='d']").textContent = pad2(parts.days);
        card.querySelector("[data-k='h']").textContent = pad2(parts.hours);
        card.querySelector("[data-k='m']").textContent = pad2(parts.minutes);
        card.querySelector("[data-k='s']").textContent = pad2(parts.seconds);
      }
    }
  }

  function findEventById(id) {
    for (var i = 0; i < state.events.length; i++) {
      if (state.events[i].id === id) return state.events[i];
    }
    return null;
  }

  function getMainEvent() {
    if (state.mainId) {
      var byId = findEventById(state.mainId);
      if (byId) return byId;
    }
    if (state.events.length > 0) return state.events[0];
    return null;
  }

  /** Пересчитать targetISO для пресетов (чтобы всегда было «ближайшее» событие) */
  function recalcPresetTarget(ev) {
    if (!ev || !ev.type) return ev;
    if (ev.type === "vacation") {
      ev.targetISO = nextVacationDate().toISOString();
      ev.name = Data.PRESET_NAMES.vacation;
      ev.extraDate = null;
      ev.timeZone = MONTENEGRO_TZ;
    } else if (ev.type === "newyear") {
      ev.targetISO = nextNewYearDate().toISOString();
      ev.name = Data.PRESET_NAMES.newyear;
      ev.extraDate = null;
    } else if (ev.type === "christmas") {
      ev.targetISO = nextFixedMontenegroDate(11, 25).toISOString();
      ev.name = Data.PRESET_NAMES.christmas || "Рождество";
      ev.extraDate = null;
      ev.timeZone = MONTENEGRO_TZ;
    } else if (ev.type === "valentine") {
      ev.targetISO = nextFixedLocalDate(1, 14).toISOString();
      ev.name = Data.PRESET_NAMES.valentine || "14 февраля";
      ev.extraDate = null;
      delete ev.timeZone;
    } else if (ev.type === "march8") {
      ev.targetISO = nextFixedLocalDate(2, 8).toISOString();
      ev.name = Data.PRESET_NAMES.march8 || "8 марта";
      ev.extraDate = null;
      delete ev.timeZone;
    } else if (ev.type === "may9") {
      ev.targetISO = nextFixedLocalDate(4, 9).toISOString();
      ev.name = Data.PRESET_NAMES.may9 || "9 мая";
      ev.extraDate = null;
      delete ev.timeZone;
    } else if (ev.type === "school") {
      ev.targetISO = nextFixedLocalDate(8, 1).toISOString();
      ev.name = Data.PRESET_NAMES.school || "1 сентября";
      ev.extraDate = null;
      delete ev.timeZone;
    } else if (ev.type === "halloween") {
      ev.targetISO = nextFixedLocalDate(9, 31).toISOString();
      ev.name = Data.PRESET_NAMES.halloween || "Хэллоуин";
      ev.extraDate = null;
      delete ev.timeZone;
    } else if (ev.type === "birthday" && ev.extraDate) {
      ev.targetISO = nextBirthdayDate(ev.extraDate).toISOString();
      ev.name = Data.PRESET_NAMES.birthday;
    }
    return ev;
  }

  /** Отобразить выбранное событие на странице */
  function renderMainEvent(ev) {
    if (!ev) {
      eventNameEl.textContent = "Выбери событие выше";
      eventDateDisplay.textContent = "—";
      pastMessage.hidden = true;
      daysEl.textContent = "00";
      hoursEl.textContent = "00";
      minutesEl.textContent = "00";
      secondsEl.textContent = "00";
      applyTheme("custom");
      updateDailyBlocks("custom");
      return;
    }

    var target = new Date(ev.targetISO);
    eventNameEl.textContent = ev.name;
    eventDateDisplay.textContent = formatDateRu(target, ev.timeZone);
    eventDateDisplay.setAttribute("datetime", ev.targetISO);

    applyTheme(ev.type);
    updateDailyBlocks(ev.type);
    updateMainCountdown();
  }

  function renderEventsList() {
    if (!eventsListEl) return;

    eventsListEl.innerHTML = "";
    eventsEmptyEl.hidden = state.events.length !== 0;

    for (var i = 0; i < state.events.length; i++) {
      var ev = state.events[i];
      var isMain = ev.id === state.mainId || (!state.mainId && i === 0);

      var parts = getCountdownParts(ev.targetISO);
      var card = document.createElement("article");
      card.className = "event-item" + (isMain ? " event-item--main" : "");
      card.setAttribute("data-event-id", ev.id);

      var badge = isMain ? "<span class=\"event-item__badge\" title=\"Главное событие\">⭐ Главное</span>" : "";

      card.innerHTML =
        "<div class=\"event-item__top\">" +
          "<div>" +
            "<div class=\"event-item__name\"></div>" +
            "<div class=\"event-item__date\"></div>" +
          "</div>" +
          badge +
        "</div>" +
        "<div class=\"event-item__status\" " + (parts.isPast ? "" : "hidden") + ">🎉 Событие уже наступило!</div>" +
        "<div class=\"mini-countdown\" " + (parts.isPast ? "hidden" : "") + ">" +
          "<div class=\"mini-countdown__box\"><span class=\"mini-countdown__value\" data-k=\"d\">00</span><span class=\"mini-countdown__label\">дней</span></div>" +
          "<div class=\"mini-countdown__box\"><span class=\"mini-countdown__value\" data-k=\"h\">00</span><span class=\"mini-countdown__label\">час</span></div>" +
          "<div class=\"mini-countdown__box\"><span class=\"mini-countdown__value\" data-k=\"m\">00</span><span class=\"mini-countdown__label\">мин</span></div>" +
          "<div class=\"mini-countdown__box\"><span class=\"mini-countdown__value\" data-k=\"s\">00</span><span class=\"mini-countdown__label\">сек</span></div>" +
        "</div>" +
        "<div class=\"event-item__actions\">" +
          "<button class=\"btn btn--ghost\" type=\"button\" data-action=\"set-main\">Сделать главным</button>" +
          "<button class=\"btn btn--danger\" type=\"button\" data-action=\"remove\">Удалить</button>" +
        "</div>";

      card.querySelector(".event-item__name").textContent = ev.name;
      card.querySelector(".event-item__date").textContent = "Дата: " + formatDateRu(new Date(ev.targetISO), ev.timeZone);

      // Заполним мини-цифры сразу
      if (!parts.isPast) {
        card.querySelector("[data-k='d']").textContent = pad2(parts.days);
        card.querySelector("[data-k='h']").textContent = pad2(parts.hours);
        card.querySelector("[data-k='m']").textContent = pad2(parts.minutes);
        card.querySelector("[data-k='s']").textContent = pad2(parts.seconds);
      }

      eventsListEl.appendChild(card);
    }
  }

  function persist() {
    saveToStorage({ events: state.events, mainId: state.mainId });
  }

  function setMainEvent(id) {
    state.mainId = id;
    persist();
    var main = getMainEvent();
    renderMainEvent(main);
    renderEventsList();
  }

  function removeEvent(id) {
    var next = [];
    for (var i = 0; i < state.events.length; i++) {
      if (state.events[i].id !== id) next.push(state.events[i]);
    }
    state.events = next;
    if (state.mainId === id) state.mainId = null;
    persist();
    renderMainEvent(getMainEvent());
    renderEventsList();
  }

  function clearAllEvents() {
    state.events = [];
    state.mainId = null;
    persist();
    renderMainEvent(null);
    renderEventsList();
  }

  // ——— Обработчики событий ———

  form.addEventListener("change", function (e) {
    if (e.target.name === "event-type") {
      updateFormFields();
    }
  });

  form.addEventListener("submit", function (e) {
    e.preventDefault();

    var built = buildEventFromForm();
    if (!built) {
      alert("Выбери тип события.");
      return;
    }
    if (built.error) {
      alert(built.error);
      return;
    }

    // Пересчёт даты для пресетов при каждой отправке
    recalcPresetTarget(built);

    // Подтверждение при добавлении нового события
    var okAdd = confirm("Добавить событие в список?");
    if (!okAdd) return;

    state.events.unshift(built);
    // Если главного ещё нет — сделаем добавленное главным
    if (!state.mainId) state.mainId = built.id;

    persist();
    renderMainEvent(getMainEvent());
    renderEventsList();
  });

  if (eventsListEl) {
    eventsListEl.addEventListener("click", function (e) {
      var btn = e.target && e.target.closest ? e.target.closest("button[data-action]") : null;
      if (!btn) return;
      var card = btn.closest("[data-event-id]");
      if (!card) return;
      var id = card.getAttribute("data-event-id");

      if (btn.getAttribute("data-action") === "set-main") {
        var ok = confirm("Сделать это событие главным (показывать большим таймером)?");
        if (!ok) return;
        setMainEvent(id);
      } else if (btn.getAttribute("data-action") === "remove") {
        var okDel = confirm("Удалить это событие из списка?");
        if (!okDel) return;
        removeEvent(id);
      }
    });
  }

  if (clearEventsBtn) {
    clearEventsBtn.addEventListener("click", function () {
      if (state.events.length === 0) return;
      var ok = confirm("Очистить весь список событий?");
      if (!ok) return;
      clearAllEvents();
    });
  }

  // ——— Старт при загрузке страницы ———
  function init() {
    // Текущий год в футере (обновляется автоматически)
    var yearEl = document.getElementById("current-year");
    if (yearEl) yearEl.textContent = String(new Date().getFullYear());

    updateDailyBlocks("custom");

    var saved = loadFromStorage();
    if (saved && Array.isArray(saved.events)) {
      state.events = saved.events || [];
      state.mainId = saved.mainId || null;

      // Пересчитать даты пресетов на актуальные
      for (var i = 0; i < state.events.length; i++) {
        recalcPresetTarget(state.events[i]);
      }

      // Если есть события и главный не задан — выберем первый
      if (state.events.length > 0 && !state.mainId) state.mainId = state.events[0].id;

      persist();
      renderMainEvent(getMainEvent());
      renderEventsList();

      // Заполним форму по главному событию (удобно для школьного проекта)
      var main = getMainEvent();
      if (main) fillFormFromEvent(main);
    }

    if (state.events.length === 0) {
      // По умолчанию выбран Новый год
      var defaultRadio = form.querySelector('input[value="newyear"]');
      if (defaultRadio) defaultRadio.checked = true;
      updateFormFields();
      renderMainEvent(null);
      renderEventsList();
    }

    // Запускаем общий интервал обновления (и главный, и список)
    if (timerInterval) clearInterval(timerInterval);
    timerInterval = setInterval(function () {
      updateMainCountdown();
      updateListCountdowns();
    }, 1000);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})(typeof window !== "undefined" ? window : this);
