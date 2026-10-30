
(function () {
  'use strict';

  /* PURE_START */
  // 固定键名。records 是记录，profile 是小名、生日和头像。旧数据没有 profile 时当作还没设置。
  var STORAGE_KEY = 'baby_tracker_v1';

  function pad(num) {
    return String(num).padStart(2, '0');
  }

  function dayKeyFromDate(date) {
    return date.getFullYear() + '-' + pad(date.getMonth() + 1) + '-' + pad(date.getDate());
  }

  function toLocalInputValue(date) {
    return dayKeyFromDate(date) + 'T' + pad(date.getHours()) + ':' + pad(date.getMinutes());
  }

  function todayKey() {
    return dayKeyFromDate(new Date());
  }

  // 无时区的时间当成用户本地时间；带 Z 或数字偏移的先按绝对时间，再归到本地日历日。
  function parseTime(str) {
    if (typeof str !== 'string') return null;
    var text = str.trim();
    if (!text) return null;
    if (/(?:z|[+-]\d{2}:?\d{2})$/i.test(text)) {
      var zoned = new Date(text);
      return Number.isNaN(zoned.getTime()) ? null : zoned;
    }
    var match = /^(\d{4})-(\d{2})-(\d{2})(?:[T\s](\d{2}):(\d{2})(?::(\d{2}))?)?$/.exec(text);
    if (!match) {
      var fallback = new Date(text);
      return Number.isNaN(fallback.getTime()) ? null : fallback;
    }
    var year = Number(match[1]);
    var month = Number(match[2]);
    var day = Number(match[3]);
    var hour = Number(match[4] || '0');
    var minute = Number(match[5] || '0');
    var second = Number(match[6] || '0');
    if (month < 1 || month > 12 || day < 1 || day > 31) return null;
    if (hour > 23 || minute > 59 || second > 59) return null;
    var date = new Date(year, month - 1, day, hour, minute, second);
    if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) return null;
    return date;
  }

  function localDayOf(str) {
    var date = parseTime(str);
    if (!date) return '';
    return dayKeyFromDate(date);
  }

  function timeValue(str) {
    var date = parseTime(str);
    return date ? date.getTime() : 0;
  }

  function addDays(dateKey, delta) {
    var match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateKey);
    if (!match) return '';
    var date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
    date.setDate(date.getDate() + delta);
    return dayKeyFromDate(date);
  }

  // 历史日期不能走到今天之后。走不过去时停在原日。
  function shiftDate(current, delta, today) {
    var next = addDays(current, delta);
    if (!next || next > today) return current;
    return next;
  }

  function parseAmount(raw) {
    var text = String(raw == null ? '' : raw).trim();
    if (text === '') return { ok: false, empty: true, value: 0 };
    if (!/^(?:\d+\.?\d*|\.\d+)$/.test(text)) return { ok: false, empty: false, value: 0 };
    var value = Number(text);
    if (!Number.isFinite(value) || value < 0) return { ok: false, empty: false, value: 0 };
    return { ok: true, empty: false, value: value };
  }

  function validateFeedInput(input) {
    var time = String(input.time || '').trim();
    var end = String(input.end || '').trim();
    if (!parseTime(time)) return { ok: false, message: '开始时间没填好' };
    if (end) {
      if (!parseTime(end)) return { ok: false, message: '结束时间没填好' };
      if (parseTime(end).getTime() <= parseTime(time).getTime()) {
        return { ok: false, message: '结束时间要晚于开始时间' };
      }
    }
    var note = String(input.note || '').trim().slice(0, 200);
    var record;
    if (input.feedType === 'breast') {
      var left = parseAmount(input.left);
      var right = parseAmount(input.right);
      if (!left.ok || !right.ok) {
        var invalid = (!left.ok && !left.empty) || (!right.ok && !right.empty);
        return { ok: false, message: invalid ? '分钟要填不小于 0 的数字' : '左右分钟都要填' };
      }
      if (left.value === 0 && right.value === 0) return { ok: false, message: '至少一侧要大于 0' };
      record = { type: 'feed', time: time, feedType: 'breast', leftMin: left.value, rightMin: right.value, note: note };
    } else if (input.feedType === 'breast_bottle' || input.feedType === 'formula') {
      var ml = parseAmount(input.amount);
      if (!ml.ok || ml.value <= 0) {
        return { ok: false, message: ml.empty ? '奶量要填' : '奶量要填大于 0 的数字' };
      }
      record = { type: 'feed', time: time, feedType: input.feedType, amountMl: ml.value, note: note };
    } else {
      return { ok: false, message: '类型没选好' };
    }
    if (end) record.end = end;
    return { ok: true, message: '', record: record };
  }

  function validateDiaperInput(input) {
    var time = String(input.time || '').trim();
    if (!parseTime(time)) return { ok: false, message: '时间没填好' };
    if (input.kind !== 'poop' && input.kind !== 'pee' && input.kind !== 'both') {
      return { ok: false, message: '要选大便、小便或都有' };
    }
    var note = String(input.note || '').trim().slice(0, 200);
    return { ok: true, message: '', record: { type: input.kind, time: time, note: note } };
  }

  function validateSleepInput(input) {
    var start = String(input.start || '').trim();
    if (!parseTime(start)) return { ok: false, message: '开始时间没填好' };
    var note = String(input.note || '').trim().slice(0, 200);
    var end = String(input.end || '').trim();
    var record = { type: 'sleep', time: start, note: note };
    if (!end) return { ok: true, message: '', record: record };
    if (!parseTime(end)) return { ok: false, message: '结束时间没填好' };
    if (parseTime(end).getTime() <= parseTime(start).getTime()) {
      return { ok: false, message: '结束时间要晚于开始时间' };
    }
    record.end = end;
    return { ok: true, message: '', record: record };
  }

  function prettyNumber(value) {
    var num = Number(value);
    if (!Number.isFinite(num)) return '0';
    return String(Math.round(num * 10) / 10);
  }

  function clockText(timeStr) {
    var date = parseTime(timeStr);
    if (!date) return String(timeStr || '');
    return pad(date.getHours()) + ':' + pad(date.getMinutes());
  }

  // 结束空着、或结束不晚于开始时，不编造时长。
  function sleepSpanMs(rec) {
    if (!rec || typeof rec.end !== 'string' || !rec.end.trim()) return null;
    var start = parseTime(rec.time);
    var end = parseTime(rec.end);
    if (!start || !end) return null;
    var diff = end.getTime() - start.getTime();
    return diff > 0 ? diff : null;
  }

  function formatDuration(ms) {
    if (!(ms > 0)) return '';
    var totalMin = Math.floor(ms / 60000);
    if (totalMin < 1) return '不足 1 分';
    var hours = Math.floor(totalMin / 60);
    var mins = totalMin % 60;
    if (hours && mins) return hours + ' 小时 ' + mins + ' 分';
    if (hours) return hours + ' 小时';
    return mins + ' 分';
  }

  function describe(rec) {
    if (rec.type === 'poop') return '大便';
    if (rec.type === 'pee') return '小便';
    if (rec.type === 'both') return '都有';
    if (rec.type === 'sleep') {
      var span = sleepSpanMs(rec);
      if (span != null) return formatDuration(span);
      if (typeof rec.end === 'string' && rec.end.trim()) return '';
      return '还在睡';
    }
    if (rec.feedType === 'breast') {
      return '亲喂 · 左 ' + prettyNumber(rec.leftMin) + ' 分 · 右 ' + prettyNumber(rec.rightMin) + ' 分';
    }
    var name = rec.feedType === 'formula' ? '配方奶' : '母乳瓶喂';
    return name + ' · ' + prettyNumber(rec.amountMl) + ' ml';
  }

  function nonNegative(value) {
    var num = Number(value);
    if (!Number.isFinite(num) || num < 0) return 0;
    return num;
  }

  // 母乳瓶喂和配方奶分开计毫升。亲喂只计入喂奶次数。睡眠按开始时间归到当天。
  function summarize(records, dateKey) {
    var rows = [];
    for (var i = 0; i < records.length; i += 1) {
      if (localDayOf(records[i].time) === dateKey) rows.push({ rec: records[i], index: i });
    }
    rows.sort(function (a, b) {
      var delta = timeValue(b.rec.time) - timeValue(a.rec.time);
      if (delta !== 0) return delta;
      return b.index - a.index;
    });
    var feedCount = 0;
    var breastBottleMl = 0;
    var formulaMl = 0;
    var poopCount = 0;
    var peeCount = 0;
    var sleepCount = 0;
    var sleepMs = 0;
    var list = [];
    for (var n = 0; n < rows.length; n += 1) {
      var rec = rows[n].rec;
      list.push(rec);
      if (rec.type === 'feed') {
        feedCount += 1;
        if (rec.feedType === 'breast_bottle') breastBottleMl += nonNegative(rec.amountMl);
        else if (rec.feedType === 'formula') formulaMl += nonNegative(rec.amountMl);
      } else if (rec.type === 'poop') {
        poopCount += 1;
      } else if (rec.type === 'pee') {
        peeCount += 1;
      } else if (rec.type === 'both') {
        // 都有：大便和小便各计 1 次。旧的分开记录仍按各自类型计数。
        poopCount += 1;
        peeCount += 1;
      } else if (rec.type === 'sleep') {
        sleepCount += 1;
        var span = sleepSpanMs(rec);
        if (span != null) sleepMs += span;
      }
    }
    return {
      list: list,
      feedCount: feedCount,
      breastBottleMl: Math.round(breastBottleMl * 10) / 10,
      formulaMl: Math.round(formulaMl * 10) / 10,
      poopCount: poopCount,
      peeCount: peeCount,
      sleepCount: sleepCount,
      sleepMs: sleepMs
    };
  }

  // 只按 id 删除一条。
  function removeRecord(records, id) {
    return records.filter(function (rec) { return rec.id !== id; });
  }

  function safeUuid() {
    try {
      if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
    } catch (err) { return ''; }
    return '';
  }

  function fallbackId() {
    return 'r-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
  }

  function createId(seen) {
    for (var i = 0; i < 6; i += 1) {
      var id = safeUuid() || fallbackId();
      if (!seen || !seen.has(id)) return id;
    }
    return fallbackId() + fallbackId();
  }

  function normalizeRecord(raw, seen) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
    var type = raw.type;
    if (type !== 'feed' && type !== 'poop' && type !== 'pee' && type !== 'both' && type !== 'sleep') return null;
    if (typeof raw.time !== 'string' || !parseTime(raw.time)) return null;
    var note = typeof raw.note === 'string' ? raw.note.trim().slice(0, 200) : '';
    var feedType = '';
    var leftMin = 0;
    var rightMin = 0;
    var amountMl = 0;
    var end = '';
    if ((type === 'sleep' || type === 'feed') && typeof raw.end === 'string' && raw.end.trim() && parseTime(raw.end)) {
      end = raw.end.trim();
    }
    if (type === 'feed') {
      if (raw.feedType === 'breast') {
        feedType = 'breast';
        leftMin = nonNegative(raw.leftMin);
        rightMin = nonNegative(raw.rightMin);
      } else if (raw.feedType === 'breast_bottle' || raw.feedType === 'formula') {
        feedType = raw.feedType;
        amountMl = nonNegative(raw.amountMl);
      } else {
        return null;
      }
    }
    var id = typeof raw.id === 'string' ? raw.id.trim() : '';
    if (!id || seen.has(id)) id = createId(seen);
    seen.add(id);
    var rec = { id: id, type: type, time: raw.time.trim(), note: note };
    if (feedType) rec.feedType = feedType;
    if (feedType === 'breast') {
      rec.leftMin = leftMin;
      rec.rightMin = rightMin;
    } else if (feedType) {
      rec.amountMl = amountMl;
    }
    if ((type === 'sleep' || type === 'feed') && end) rec.end = end;
    return rec;
  }

  function blankProfile() {
    return { name: '', birthday: '', avatar: '' };
  }

  function lastDayOfMonth(year, monthIndex) {
    return new Date(year, monthIndex + 1, 0).getDate();
  }

  function addCalendarMonths(year, monthIndex, day, count) {
    var index = monthIndex + count;
    var nextYear = year + Math.floor(index / 12);
    var nextMonth = index % 12;
    if (nextMonth < 0) {
      nextMonth += 12;
      nextYear -= 1;
    }
    return { y: nextYear, m: nextMonth, d: Math.min(day, lastDayOfMonth(nextYear, nextMonth)) };
  }

  function compareYmd(a, b) {
    if (a.y !== b.y) return a.y - b.y;
    if (a.m !== b.m) return a.m - b.m;
    return a.d - b.d;
  }

  // 按本地日历从生日数到今天。未满 1 个月只留天数，出生当天是 0 天。满月、满岁后省略为 0 的部分。
  function ageParts(birthdayKey, todayKeyStr) {
    var birth = parseTime(birthdayKey);
    var today = parseTime(todayKeyStr);
    if (!birth || !today) return null;
    var b = { y: birth.getFullYear(), m: birth.getMonth(), d: birth.getDate() };
    var t = { y: today.getFullYear(), m: today.getMonth(), d: today.getDate() };
    if (compareYmd(t, b) < 0) return null;
    var years = t.y - b.y;
    var cursor = addCalendarMonths(b.y, b.m, b.d, years * 12);
    if (compareYmd(cursor, t) > 0) {
      years -= 1;
      cursor = addCalendarMonths(b.y, b.m, b.d, years * 12);
    }
    var months = 0;
    while (months < 12) {
      var next = addCalendarMonths(b.y, b.m, b.d, years * 12 + months + 1);
      if (compareYmd(next, t) > 0) break;
      months += 1;
      cursor = next;
    }
    var days = Math.round((Date.UTC(t.y, t.m, t.d) - Date.UTC(cursor.y, cursor.m, cursor.d)) / 86400000);
    return { years: years, months: months, days: days };
  }

  function formatAge(birthdayKey, todayKeyStr) {
    var parts = ageParts(birthdayKey, todayKeyStr);
    if (!parts) return '';
    if (parts.years === 0 && parts.months === 0) return parts.days + ' 天';
    var bits = [];
    if (parts.years > 0) bits.push(parts.years + ' 岁');
    if (parts.months > 0) bits.push(parts.months + ' 个月');
    if (parts.days > 0) bits.push(parts.days + ' 天');
    return bits.join(' ');
  }

  function normalizeProfile(raw) {
    var profile = blankProfile();
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return profile;
    if (typeof raw.name === 'string') profile.name = raw.name.trim().slice(0, 40);
    if (typeof raw.birthday === 'string') {
      var text = raw.birthday.trim();
      var date = parseTime(text);
      if (date && /^\d{4}-\d{2}-\d{2}$/.test(text)) {
        var key = dayKeyFromDate(date);
        if (key <= todayKey()) profile.birthday = key;
      }
    }
    if (typeof raw.avatar === 'string' && /^data:image\/jpeg;base64,[a-z0-9+/=]+$/i.test(raw.avatar) && raw.avatar.length <= 150000) {
      profile.avatar = raw.avatar;
    }
    return profile;
  }

  function sanitize(raw) {
    var seen = new Set();
    var records = [];
    var list = raw && Array.isArray(raw.records) ? raw.records : [];
    for (var i = 0; i < list.length; i += 1) {
      var rec = normalizeRecord(list[i], seen);
      if (rec) records.push(rec);
    }
    var hasProfile = !!(raw && typeof raw === 'object' && !Array.isArray(raw) && Object.prototype.hasOwnProperty.call(raw, 'profile'));
    return { records: records, profile: hasProfile ? normalizeProfile(raw.profile) : blankProfile() };
  }
  /* PURE_END */

  var data = loadData();
  var currentTab = 'home';
  var editingId = '';
  var editingKind = '';
  var historyDate = todayKey();
  var lastSeenToday = historyDate;
  var statusTimer = 0;

  function loadData() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return sanitize(null);
      return sanitize(JSON.parse(raw));
    } catch (err) {
      return sanitize(null);
    }
  }

  function persist() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
      return true;
    } catch (err) {
      alert('浏览器存不下了，先导出备份吧。');
      return false;
    }
  }

  function setStatus(text) {
    var el = document.getElementById('status');
    el.textContent = text;
    if (statusTimer) clearTimeout(statusTimer);
    statusTimer = setTimeout(function () { el.textContent = ''; }, 2200);
  }

  function clearFormMessage(form) {
    var el = form.querySelector('[data-err]');
    el.textContent = '';
    el.classList.remove('ok');
  }

  function showFormMessage(form, text, ok) {
    var el = form.querySelector('[data-err]');
    el.textContent = text;
    el.classList.toggle('ok', !!ok);
  }

  function prettyStamp(date) {
    return (date.getMonth() + 1) + '月' + date.getDate() + '日 ' + pad(date.getHours()) + ':' + pad(date.getMinutes());
  }

  function paintTimeField(input) {
    var text = input.parentElement && input.parentElement.querySelector('.time-field-text');
    if (!text) return;
    var date = parseTime(input.value);
    if (!date) {
      text.textContent = '选择时间';
      text.classList.add('is-empty');
      return;
    }
    text.textContent = prettyStamp(date);
    text.classList.remove('is-empty');
  }

  function stampNow(input) {
    input.value = toLocalInputValue(new Date());
    input.dataset.touched = '0';
    paintTimeField(input);
  }

  function refreshUntouchedTimes() {
    document.querySelectorAll('[data-time="now"]').forEach(function (input) {
      if (input.dataset.touched === '1') return;
      if (input === activeTimeInput) return;
      stampNow(input);
    });
  }

  function clearTime(input) {
    input.value = '';
    input.dataset.touched = '0';
    paintTimeField(input);
  }

  // 没改过时间就用提交当时；改过就保留用户选的本地时间。
  function currentTimeValue(input) {
    if (input.dataset.touched !== '1') stampNow(input);
    return input.value.trim();
  }

  function bindTimeInput(input) {
    stampNow(input);
    input.addEventListener('input', function () { input.dataset.touched = '1'; });
  }

  var TIME_ROW = 44;
  var timeSheet;
  var dateCol;
  var hourCol;
  var minuteCol;
  var timePreview;
  var activeTimeInput = null;
  var timeDates = [];
  var dateIndex = 0;
  var hourIndex = 0;
  var minuteIndex = 0;
  var ignoreTimeScroll = false;

  function fillTimeColumn(col, labels, onPick) {
    col.replaceChildren();
    var topPad = document.createElement('div');
    topPad.className = 'time-pad';
    col.appendChild(topPad);
    labels.forEach(function (label, i) {
      var opt = document.createElement('div');
      opt.className = 'time-opt';
      opt.textContent = label;
      opt.addEventListener('click', function () {
        col.scrollTop = i * TIME_ROW;
        onPick(i);
      });
      col.appendChild(opt);
    });
    var bottomPad = document.createElement('div');
    bottomPad.className = 'time-pad';
    col.appendChild(bottomPad);
  }

  function timeColumnIndex(col) {
    var max = col.querySelectorAll('.time-opt').length - 1;
    var index = Math.round(col.scrollTop / TIME_ROW);
    if (index < 0) index = 0;
    if (index > max) index = max;
    return index;
  }

  function markTimeColumn(col, index) {
    var opts = col.querySelectorAll('.time-opt');
    for (var i = 0; i < opts.length; i += 1) opts[i].classList.toggle('is-on', i === index);
  }

  function chosenTime() {
    var base = timeDates[dateIndex] || new Date();
    return new Date(base.getFullYear(), base.getMonth(), base.getDate(), hourIndex, minuteIndex, 0, 0);
  }

  function refreshTimePreview() {
    timePreview.textContent = prettyStamp(chosenTime());
    markTimeColumn(dateCol, dateIndex);
    markTimeColumn(hourCol, hourIndex);
    markTimeColumn(minuteCol, minuteIndex);
  }

  function watchTimeColumn(col, assign) {
    col.addEventListener('scroll', function () {
      if (ignoreTimeScroll || timeSheet.hidden) return;
      assign(timeColumnIndex(col));
      refreshTimePreview();
      if (col._timer) clearTimeout(col._timer);
      col._timer = setTimeout(function () {
        var index = timeColumnIndex(col);
        if (Math.abs(col.scrollTop - index * TIME_ROW) > 1) {
          ignoreTimeScroll = true;
          col.scrollTop = index * TIME_ROW;
          ignoreTimeScroll = false;
        }
        assign(index);
        refreshTimePreview();
      }, 80);
    }, { passive: true });
  }

  function setupTimeSheet() {
    timeSheet = document.getElementById('time-sheet');
    dateCol = document.getElementById('time-col-date');
    hourCol = document.getElementById('time-col-hour');
    minuteCol = document.getElementById('time-col-minute');
    timePreview = document.getElementById('time-sheet-preview');
    var hours = [];
    var minutes = [];
    for (var h = 0; h < 24; h += 1) hours.push(pad(h));
    for (var m = 0; m < 60; m += 1) minutes.push(pad(m));
    fillTimeColumn(hourCol, hours, function (i) { hourIndex = i; refreshTimePreview(); });
    fillTimeColumn(minuteCol, minutes, function (i) { minuteIndex = i; refreshTimePreview(); });
    watchTimeColumn(dateCol, function (i) { dateIndex = i; });
    watchTimeColumn(hourCol, function (i) { hourIndex = i; });
    watchTimeColumn(minuteCol, function (i) { minuteIndex = i; });
    timeSheet.addEventListener('click', function (event) {
      if (event.target.closest('[data-cancel]')) closeTimeSheet(false);
      else if (event.target.closest('[data-ok]')) closeTimeSheet(true);
    });
    document.addEventListener('keydown', function (event) {
      if (event.key === 'Escape' && activeTimeInput) closeTimeSheet(false);
    });
    timeSheet.addEventListener('touchmove', function (event) {
      if (!event.target.closest('.time-col')) event.preventDefault();
    }, { passive: false });
  }

  function fillTimeDates() {
    var today = new Date();
    var todayStr = todayKey();
    timeDates = [];
    for (var i = 60; i >= 0; i -= 1) {
      timeDates.push(new Date(today.getFullYear(), today.getMonth(), today.getDate() - i, 12, 0, 0, 0));
    }
    fillTimeColumn(dateCol, timeDates.map(function (d) {
      return dayKeyFromDate(d) === todayStr ? '今天' : (d.getMonth() + 1) + '月' + d.getDate() + '日';
    }), function (i) { dateIndex = i; refreshTimePreview(); });
  }

  function openTimeSheet(input) {
    activeTimeInput = input;
    fillTimeDates();
    var parsed = parseTime(input.value);
    var initial = parsed || new Date();
    var key = dayKeyFromDate(initial);
    var earliest = dayKeyFromDate(timeDates[0]);
    var today = todayKey();
    if (key > today) key = today;
    if (key < earliest) key = earliest;
    dateIndex = 0;
    for (var i = 0; i < timeDates.length; i += 1) {
      if (dayKeyFromDate(timeDates[i]) === key) dateIndex = i;
    }
    hourIndex = initial.getHours();
    minuteIndex = initial.getMinutes();
    document.documentElement.classList.add('time-open');
    timeSheet.hidden = false;
    refreshTimePreview();
    returnFocus = input.parentElement.querySelector('.time-field');
    focusSheetCancel(timeSheet);
    requestAnimationFrame(function () {
      ignoreTimeScroll = true;
      dateCol.scrollTop = dateIndex * TIME_ROW;
      hourCol.scrollTop = hourIndex * TIME_ROW;
      minuteCol.scrollTop = minuteIndex * TIME_ROW;
      refreshTimePreview();
      requestAnimationFrame(function () { ignoreTimeScroll = false; });
    });
  }

  function closeTimeSheet(commit) {
    if (commit && activeTimeInput) {
      dateIndex = timeColumnIndex(dateCol);
      hourIndex = timeColumnIndex(hourCol);
      minuteIndex = timeColumnIndex(minuteCol);
      activeTimeInput.value = toLocalInputValue(chosenTime());
      activeTimeInput.dataset.touched = '1';
      paintTimeField(activeTimeInput);
      activeTimeInput.dispatchEvent(new Event('input', { bubbles: true }));
    }
    activeTimeInput = null;
    timeSheet.hidden = true;
    document.documentElement.classList.remove('time-open');
    restoreFocus();
  }

  function bindTimeFields() {
    setupTimeSheet();
    document.querySelectorAll('[data-time]').forEach(function (input) {
      if (input.dataset.time === 'now') bindTimeInput(input);
      else paintTimeField(input);
      input.parentElement.querySelector('.time-field').addEventListener('click', function () {
        openTimeSheet(input);
      });
    });
  }

  var DATE_ROW = 44;
  var dateSheet;
  var yearCol;
  var monthCol;
  var dayCol;
  var datePreview;
  var yearLabels = [];
  var yearIndex = 0;
  var monthIndex = 0;
  var dayIndex = 0;
  var dateIgnore = false;

  function dateColIndex(col) {
    var max = col.querySelectorAll('.time-opt').length - 1;
    var index = Math.round(col.scrollTop / DATE_ROW);
    if (index < 0) index = 0;
    if (index > max) index = max;
    return index;
  }

  function fillDateCol(col, labels) {
    col.replaceChildren();
    var topPad = document.createElement('div');
    topPad.className = 'time-pad';
    col.appendChild(topPad);
    labels.forEach(function (label, i) {
      var opt = document.createElement('div');
      opt.className = 'time-opt';
      opt.textContent = label;
      opt.addEventListener('click', function () { col.scrollTop = i * DATE_ROW; });
      col.appendChild(opt);
    });
    var bottomPad = document.createElement('div');
    bottomPad.className = 'time-pad';
    col.appendChild(bottomPad);
  }

  function markDateCol(col, index) {
    var opts = col.querySelectorAll('.time-opt');
    for (var i = 0; i < opts.length; i += 1) opts[i].classList.toggle('is-on', i === index);
  }

  function selectedYear() {
    return yearLabels[yearIndex] || new Date().getFullYear();
  }

  function monthLimit() {
    var today = new Date();
    if (selectedYear() < today.getFullYear()) return 12;
    return today.getMonth() + 1;
  }

  function dayLimit() {
    var today = new Date();
    var monthNumber = monthIndex + 1;
    var last = new Date(selectedYear(), monthNumber, 0).getDate();
    if (selectedYear() === today.getFullYear() && monthNumber === today.getMonth() + 1) return today.getDate();
    return last;
  }

  function rebuildMonths() {
    var count = monthLimit();
    var labels = [];
    for (var i = 1; i <= count; i += 1) labels.push(i + '月');
    if (monthIndex > count - 1) monthIndex = count - 1;
    if (monthIndex < 0) monthIndex = 0;
    dateIgnore = true;
    fillDateCol(monthCol, labels);
    monthCol.scrollTop = monthIndex * DATE_ROW;
    dateIgnore = false;
  }

  function rebuildDays() {
    var count = dayLimit();
    var labels = [];
    for (var i = 1; i <= count; i += 1) labels.push(i + '日');
    if (dayIndex > count - 1) dayIndex = count - 1;
    if (dayIndex < 0) dayIndex = 0;
    dateIgnore = true;
    fillDateCol(dayCol, labels);
    dayCol.scrollTop = dayIndex * DATE_ROW;
    dateIgnore = false;
  }

  function refreshDatePreview() {
    datePreview.textContent = selectedYear() + '年' + (monthIndex + 1) + '月' + (dayIndex + 1) + '日';
    markDateCol(yearCol, yearIndex);
    markDateCol(monthCol, monthIndex);
    markDateCol(dayCol, dayIndex);
  }

  function watchDateCol(col, kind) {
    col.addEventListener('scroll', function () {
      if (dateIgnore || dateSheet.hidden) return;
      var index = dateColIndex(col);
      var changed = false;
      if (kind === 'year' && index !== yearIndex) { yearIndex = index; changed = true; }
      if (kind === 'month' && index !== monthIndex) { monthIndex = index; changed = true; }
      if (kind === 'day') dayIndex = index;
      if (kind === 'year' && changed) { rebuildMonths(); rebuildDays(); }
      if (kind === 'month' && changed) rebuildDays();
      refreshDatePreview();
      if (col._timer) clearTimeout(col._timer);
      col._timer = setTimeout(function () {
        if (dateSheet.hidden) return;
        var snapped = dateColIndex(col);
        if (Math.abs(col.scrollTop - snapped * DATE_ROW) > 1) {
          dateIgnore = true;
          col.scrollTop = snapped * DATE_ROW;
          dateIgnore = false;
        }
        if (kind === 'year' && snapped !== yearIndex) {
          yearIndex = snapped;
          rebuildMonths();
          rebuildDays();
        } else if (kind === 'month' && snapped !== monthIndex) {
          monthIndex = snapped;
          rebuildDays();
        } else if (kind === 'day') {
          dayIndex = snapped;
        }
        refreshDatePreview();
      }, 80);
    }, { passive: true });
  }

  function setupDateSheet() {
    dateSheet = document.getElementById('date-sheet');
    yearCol = document.getElementById('date-col-year');
    monthCol = document.getElementById('date-col-month');
    dayCol = document.getElementById('date-col-day');
    datePreview = document.getElementById('date-sheet-preview');
    watchDateCol(yearCol, 'year');
    watchDateCol(monthCol, 'month');
    watchDateCol(dayCol, 'day');
    dateSheet.addEventListener('click', function (event) {
      if (event.target.closest('[data-cancel]')) closeDateSheet(false);
      else if (event.target.closest('[data-ok]')) closeDateSheet(true);
    });
    document.addEventListener('keydown', function (event) {
      if (event.key === 'Escape' && dateSheet && !dateSheet.hidden) closeDateSheet(false);
    });
    dateSheet.addEventListener('touchmove', function (event) {
      if (!event.target.closest('.time-col')) event.preventDefault();
    }, { passive: false });
  }

  function openDateSheet() {
    var today = new Date();
    var initial = parseTime(data.profile.birthday) || today;
    if (dayKeyFromDate(initial) > todayKey()) initial = today;
    var start = today.getFullYear() - 20;
    if (initial.getFullYear() < start) start = initial.getFullYear();
    yearLabels = [];
    for (var y = start; y <= today.getFullYear(); y += 1) yearLabels.push(y);
    fillDateCol(yearCol, yearLabels.map(function (year) { return year + '年'; }));
    yearIndex = Math.max(0, yearLabels.indexOf(initial.getFullYear()));
    monthIndex = initial.getMonth();
    dayIndex = initial.getDate() - 1;
    if (monthIndex > monthLimit() - 1) monthIndex = monthLimit() - 1;
    rebuildMonths();
    if (dayIndex > dayLimit() - 1) dayIndex = dayLimit() - 1;
    rebuildDays();
    document.documentElement.classList.add('time-open');
    dateSheet.hidden = false;
    refreshDatePreview();
    returnFocus = document.activeElement;
    focusSheetCancel(dateSheet);
    requestAnimationFrame(function () {
      dateIgnore = true;
      yearCol.scrollTop = yearIndex * DATE_ROW;
      monthCol.scrollTop = monthIndex * DATE_ROW;
      dayCol.scrollTop = dayIndex * DATE_ROW;
      refreshDatePreview();
      requestAnimationFrame(function () { dateIgnore = false; });
    });
  }

  function closeDateSheet(commit) {
    if (commit) {
      yearIndex = dateColIndex(yearCol);
      monthIndex = dateColIndex(monthCol);
      dayIndex = dateColIndex(dayCol);
      if (monthIndex > monthLimit() - 1) monthIndex = monthLimit() - 1;
      if (dayIndex > dayLimit() - 1) dayIndex = dayLimit() - 1;
      var year = selectedYear();
      var month = monthIndex + 1;
      var day = dayIndex + 1;
      var today = new Date();
      if (year === today.getFullYear() && month > today.getMonth() + 1) month = today.getMonth() + 1;
      var last = new Date(year, month, 0).getDate();
      if (day > last) day = last;
      if (year === today.getFullYear() && month === today.getMonth() + 1 && day > today.getDate()) day = today.getDate();
      var key = year + '-' + pad(month) + '-' + pad(day);
      if (key <= todayKey() && key !== data.profile.birthday) {
        data.profile.birthday = key;
        if (persist()) {
          renderProfile();
          showSettingNote(document.getElementById('settings-saved'), '已保存', true);
        }
      } else if (key <= todayKey()) {
        showSettingNote(document.getElementById('settings-saved'), '已保存', true);
      }
    }
    dateSheet.hidden = true;
    document.documentElement.classList.remove('time-open');
    restoreFocus();
  }

  var returnFocus = null;
  var nameSheet;
  var avatarSheet;

  function focusSheetCancel(sheet) {
    var button = sheet.querySelector('.time-actions [data-cancel]');
    requestAnimationFrame(function () {
      if (button && sheet && !sheet.hidden) button.focus();
    });
  }

  function restoreFocus() {
    var el = returnFocus;
    returnFocus = null;
    if (el && typeof el.focus === 'function') el.focus();
  }

  function currentSheet() {
    if (timeSheet && !timeSheet.hidden) return timeSheet;
    if (dateSheet && !dateSheet.hidden) return dateSheet;
    if (nameSheet && !nameSheet.hidden) return nameSheet;
    if (avatarSheet && !avatarSheet.hidden) return avatarSheet;
    return null;
  }

  function trapSheetTab(event) {
    if (event.key !== 'Tab') return;
    var sheet = currentSheet();
    if (!sheet) return;
    var items = Array.prototype.filter.call(sheet.querySelectorAll('button, input, select, textarea'), function (el) {
      return !el.disabled && el.tabIndex !== -1 && el.offsetParent !== null;
    });
    if (!items.length) return;
    var first = items[0];
    var last = items[items.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  function usedIds() {
    var seen = new Set();
    data.records.forEach(function (rec) { seen.add(rec.id); });
    return seen;
  }

  function refreshViews() {
    renderToday();
    renderHistory();
  }

  function renderStatGrid(container, summary) {
    container.replaceChildren();
    function card(label, value, tone, extra) {
      var div = document.createElement('div');
      div.className = 'stat tone-' + tone;
      var span = document.createElement('span');
      span.textContent = label;
      var strong = document.createElement('b');
      strong.textContent = value;
      div.append(span, strong);
      var lines = Array.isArray(extra) ? extra : (extra ? [extra] : []);
      lines.forEach(function (text) {
        var line = document.createElement('span');
        line.className = 'extra';
        line.textContent = text;
        div.appendChild(line);
      });
      container.appendChild(div);
    }
    var milkLines = [];
    if (summary.breastBottleMl > 0) milkLines.push('母乳瓶喂 ' + prettyNumber(summary.breastBottleMl) + ' ml');
    if (summary.formulaMl > 0) milkLines.push('配方奶 ' + prettyNumber(summary.formulaMl) + ' ml');
    card('喂奶次数', String(summary.feedCount), 'rose', milkLines);
    card('大便次数', String(summary.poopCount), 'gold');
    card('小便次数', String(summary.peeCount), 'green');
    var durationText = summary.sleepMs > 0 ? formatDuration(summary.sleepMs) : '0 分';
    card('睡眠次数', String(summary.sleepCount), 'blue', '总时长 ' + durationText);
  }

  function renderHistoryStats(container, summary) {
    container.replaceChildren();
    function card(label, value, tone) {
      var div = document.createElement('div');
      div.className = 'stat tone-' + tone;
      var span = document.createElement('span');
      span.textContent = label;
      var strong = document.createElement('b');
      strong.textContent = value;
      div.append(span, strong);
      container.appendChild(div);
    }
    card('喂奶次数', String(summary.feedCount), 'rose');
    if (summary.breastBottleMl > 0) card('母乳瓶喂', prettyNumber(summary.breastBottleMl) + ' ml', 'rose');
    if (summary.formulaMl > 0) card('配方奶', prettyNumber(summary.formulaMl) + ' ml', 'gold');
    card('大便次数', String(summary.poopCount), 'gold');
    card('小便次数', String(summary.peeCount), 'green');
    if (summary.sleepCount > 0) {
      card('睡眠时长', summary.sleepMs > 0 ? formatDuration(summary.sleepMs) : '还在睡', 'blue');
    }
  }

  function formatClock(timeStr) {
    var date = parseTime(timeStr);
    if (!date) return timeStr;
    return pad(date.getHours()) + ':' + pad(date.getMinutes());
  }

  function primaryLine(rec) {
    var parts = [formatClock(rec.time)];
    if (rec.type === 'poop') parts.push('大便');
    else if (rec.type === 'pee') parts.push('小便');
    else if (rec.type === 'both') parts.push('都有');
    else if (rec.type === 'sleep') {
      parts.push('睡眠');
      var span = sleepSpanMs(rec);
      if (span != null) parts.push(formatDuration(span));
      else if (!(typeof rec.end === 'string' && rec.end.trim())) parts.push('还在睡');
    } else if (rec.feedType === 'breast') {
      parts.push('亲喂');
      parts.push('左 ' + prettyNumber(rec.leftMin) + ' 分');
      parts.push('右 ' + prettyNumber(rec.rightMin) + ' 分');
    } else if (rec.type === 'feed') {
      parts.push(rec.feedType === 'formula' ? '配方奶' : '母乳瓶喂');
      parts.push(prettyNumber(rec.amountMl) + ' ml');
    }
    return parts.join(' · ');
  }

  function rangeLine(rec) {
    if (typeof rec.end !== 'string' || !rec.end.trim() || !parseTime(rec.end)) return '';
    return clockText(rec.time) + '–' + clockText(rec.end);
  }

  var SWIPE_OPEN = 72;

  function closeSwipes(except) {
    document.querySelectorAll('.log-row.is-open').forEach(function (row) {
      if (row === except) return;
      var main = row.querySelector('.log-main');
      row.classList.remove('is-open');
      if (!main) return;
      main.classList.add('is-snapping');
      main.style.transform = '';
    });
  }

  function bindSwipe(row) {
    var main = row.querySelector('.log-main');
    if (!main) return;
    var startX = 0;
    var startY = 0;
    var base = 0;
    var dragging = false;
    var axis = '';

    function paint(x) {
      var next = x;
      if (next > 0) next = 0;
      if (next < -SWIPE_OPEN) next = -SWIPE_OPEN;
      main.style.transform = next === 0 ? '' : 'translateX(' + next + 'px)';
    }

    main.addEventListener('pointerdown', function (event) {
      if (event.pointerType === 'mouse' && event.button !== 0) return;
      if (event.target.closest('.edit')) return;
      closeSwipes(row);
      dragging = true;
      axis = '';
      startX = event.clientX;
      startY = event.clientY;
      base = row.classList.contains('is-open') ? -SWIPE_OPEN : 0;
      main.classList.add('is-dragging');
      main.classList.remove('is-snapping');
      try {
        if (main.setPointerCapture) main.setPointerCapture(event.pointerId);
      } catch (err) {}
    });

    main.addEventListener('pointermove', function (event) {
      if (!dragging) return;
      var dx = event.clientX - startX;
      var dy = event.clientY - startY;
      if (!axis) {
        if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return;
        axis = Math.abs(dx) > Math.abs(dy) ? 'x' : 'y';
        if (axis !== 'x') {
          dragging = false;
          main.classList.remove('is-dragging');
          return;
        }
      }
      if (axis !== 'x') return;
      if (event.cancelable) event.preventDefault();
      paint(base + dx);
    });

    function finish(event) {
      if (!dragging) return;
      dragging = false;
      main.classList.remove('is-dragging');
      main.classList.add('is-snapping');
      if (axis !== 'x') {
        axis = '';
        return;
      }
      var next = base + (event.clientX - startX);
      if (next < -SWIPE_OPEN / 2) {
        row.classList.add('is-open');
        paint(-SWIPE_OPEN);
      } else {
        row.classList.remove('is-open');
        paint(0);
      }
      axis = '';
    }

    main.addEventListener('pointerup', finish);
    main.addEventListener('pointercancel', finish);

    var del = row.querySelector('.log-delete');
    if (del) {
      del.addEventListener('focus', function () {
        closeSwipes(row);
        row.classList.add('is-open');
        main.classList.add('is-snapping');
        paint(-SWIPE_OPEN);
      });
    }
  }

  function buildItem(rec) {
    var row = document.createElement('li');
    row.className = 'log-row';
    var summary = primaryLine(rec);
    var range = rangeLine(rec);
    var del = document.createElement('button');
    del.type = 'button';
    del.className = 'log-delete';
    del.setAttribute('data-delete', rec.id);
    del.textContent = '删除';
    del.setAttribute('aria-label', '删除 ' + summary);
    var main = document.createElement('div');
    main.className = 'log-main';
    var text = document.createElement('div');
    text.className = 'log-text';
    var line = document.createElement('p');
    line.className = 'log-line';
    line.textContent = summary;
    text.appendChild(line);
    if (range) {
      var second = document.createElement('p');
      second.className = 'log-line';
      second.textContent = range;
      text.appendChild(second);
    }
    var edit = document.createElement('button');
    edit.type = 'button';
    edit.className = 'edit';
    edit.setAttribute('data-edit', rec.id);
    edit.textContent = '编辑';
    edit.setAttribute('aria-label', '编辑 ' + (range ? summary + '，' + range : summary));
    main.append(text, edit);
    row.append(del, main);
    bindSwipe(row);
    return row;
  }

  function renderList(container, list, emptyText) {
    container.className = 'sheet today-log';
    container.replaceChildren();
    if (!list.length) {
      var empty = document.createElement('p');
      empty.className = 'empty';
      empty.textContent = emptyText;
      container.appendChild(empty);
      return;
    }
    var listEl = document.createElement('ul');
    listEl.className = 'log-list';
    list.forEach(function (rec) { listEl.appendChild(buildItem(rec)); });
    container.appendChild(listEl);
  }

  function renderToday() {
    var summary = summarize(data.records, todayKey());
    renderStatGrid(document.getElementById('today-stats'), summary);
    renderList(document.getElementById('today-list'), summary.list, '今天还没记录哦😄');
  }

  function monthDayLabel(dateKey) {
    var parts = String(dateKey || '').split('-');
    if (parts.length !== 3) return '';
    return parts[1] + '-' + parts[2];
  }

  function renderHistory() {
    var today = todayKey();
    if (historyDate > today) historyDate = today;
    document.getElementById('next-day').disabled = historyDate >= today;
    var picker = document.getElementById('history-date');
    picker.max = today;
    picker.value = historyDate;
    document.getElementById('history-md').textContent = monthDayLabel(historyDate);
    var summary = summarize(data.records, historyDate);
    renderStatGrid(document.getElementById('history-stats'), summary);
    renderList(document.getElementById('history-list'), summary.list, '这一天还没记下。');
  }

  function showKind(kind) {
    document.querySelectorAll('[data-kind]').forEach(function (button) {
      button.setAttribute('aria-selected', button.dataset.kind === kind ? 'true' : 'false');
    });
    document.querySelectorAll('[data-kind-panel]').forEach(function (panel) {
      panel.hidden = panel.dataset.kindPanel !== kind;
    });
    var editing = !!editingId && kind === editingKind;
    var hint = document.getElementById('edit-hint');
    if (hint) hint.hidden = !editing;
    refreshUntouchedTimes();
  }

  function showTab(name) {
    currentTab = name;
    document.querySelectorAll('[data-panel]').forEach(function (panel) {
      panel.hidden = panel.dataset.panel !== name;
    });
    document.querySelectorAll('[data-tab]').forEach(function (button) {
      var on = button.dataset.tab === name;
      button.setAttribute('aria-selected', on ? 'true' : 'false');
    });
    if (name === 'home') {
      renderProfile();
      renderToday();
      refreshUntouchedTimes();
    }
    if (name === 'history') renderHistory();
  }

  function showSettingNote(el, text, ok) {
    el.textContent = text;
    el.classList.toggle('is-ok', !!ok);
    el.classList.toggle('is-bad', !ok);
    if (el._timer) clearTimeout(el._timer);
    el._timer = setTimeout(function () { el.textContent = ''; }, ok ? 1100 : 2200);
  }

  function avatarAlt() {
    return (data.profile && data.profile.name) || '宝宝头像';
  }

  function paintAvatar(box, src) {
    box.replaceChildren();
    if (!src) {
      box.setAttribute('role', 'img');
      box.setAttribute('aria-label', avatarAlt());
      return;
    }
    box.removeAttribute('role');
    box.removeAttribute('aria-label');
    var img = document.createElement('img');
    img.alt = avatarAlt();
    img.src = src;
    box.appendChild(img);
  }

  function renderProfile() {
    var profile = data.profile || blankProfile();
    document.getElementById('home-name').textContent = profile.name || '宝宝';
    var age = document.getElementById('home-age');
    var go = document.getElementById('home-age-go');
    if (!profile.birthday) {
      age.hidden = true;
      age.textContent = '';
      go.hidden = false;
    } else {
      age.hidden = false;
      age.textContent = formatAge(profile.birthday, todayKey());
      go.hidden = true;
    }
    paintAvatar(document.getElementById('home-avatar'), profile.avatar);
    var nameInput = document.getElementById('profile-name');
    if (document.activeElement !== nameInput) nameInput.value = profile.name;
    document.getElementById('setting-name-value').textContent = profile.name || '未设置';
    var birthday = parseTime(profile.birthday);
    document.getElementById('setting-birthday-value').textContent = birthday
      ? birthday.getFullYear() + '年' + (birthday.getMonth() + 1) + '月' + birthday.getDate() + '日'
      : '未设置';
    document.getElementById('setting-avatar-value').textContent = profile.avatar ? '已设置' : '未设置';
    paintAvatar(document.getElementById('avatar-preview'), profile.avatar);
    document.getElementById('avatar-label').textContent = profile.avatar ? '更换照片' : '上传照片';
    fitAvatar();
  }

  function fitAvatar() {
    var nameBox = document.getElementById('home-name').getBoundingClientRect();
    var ageEl = document.getElementById('home-age');
    var go = document.getElementById('home-age-go');
    var ageBox = (go && !go.hidden ? go : ageEl).getBoundingClientRect();
    var size = Math.round(nameBox.height + ageBox.height);
    if (size < 16) return;
    var avatar = document.getElementById('home-avatar');
    avatar.style.width = size + 'px';
    avatar.style.height = size + 'px';
  }

  function saveName() {
    var input = document.getElementById('profile-name');
    var next = input.value.trim().slice(0, 40);
    input.value = next;
    if (next !== data.profile.name) {
      data.profile.name = next;
      if (!persist()) return;
      renderProfile();
    }
    showSettingNote(document.getElementById('settings-saved'), '已保存', true);
  }

  function openNameSheet() {
    returnFocus = document.activeElement;
    var input = document.getElementById('profile-name');
    input.value = data.profile.name;
    nameSheet.hidden = false;
    document.documentElement.classList.add('time-open');
    requestAnimationFrame(function () {
      if (!nameSheet.hidden) input.focus();
    });
  }

  function closeNameSheet(commit) {
    if (commit) saveName();
    nameSheet.hidden = true;
    if (!dateSheet || dateSheet.hidden) document.documentElement.classList.remove('time-open');
    restoreFocus();
  }

  function openAvatarSheet() {
    returnFocus = document.activeElement;
    avatarSheet.hidden = false;
    document.documentElement.classList.add('time-open');
    focusSheetCancel(avatarSheet);
  }

  function closeAvatarSheet() {
    avatarSheet.hidden = true;
    if ((!dateSheet || dateSheet.hidden) && (!timeSheet || timeSheet.hidden) && (!nameSheet || nameSheet.hidden)) {
      document.documentElement.classList.remove('time-open');
    }
    restoreFocus();
  }

  function compressAvatar(file) {
    return new Promise(function (resolve, reject) {
      var url = URL.createObjectURL(file);
      var img = new Image();
      img.onload = function () {
        var edge = Math.max(img.naturalWidth, img.naturalHeight) || 1;
        var scale = Math.min(1, 256 / edge);
        var canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
        canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
        var ctx = canvas.getContext('2d');
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        var quality = 0.82;
        var dataUrl = canvas.toDataURL('image/jpeg', quality);
        while (dataUrl.length > 120000 && quality > 0.5) {
          quality -= 0.08;
          dataUrl = canvas.toDataURL('image/jpeg', quality);
        }
        URL.revokeObjectURL(url);
        if (!/^data:image\/jpeg;base64,/.test(dataUrl) || dataUrl.length > 150000) {
          reject(new Error('large'));
          return;
        }
        resolve(dataUrl);
      };
      img.onerror = function () {
        URL.revokeObjectURL(url);
        reject(new Error('read'));
      };
      img.src = url;
    });
  }

  function bindSettings() {
    setupDateSheet();
    nameSheet = document.getElementById('name-sheet');
    avatarSheet = document.getElementById('avatar-sheet');
    document.getElementById('open-name').addEventListener('click', openNameSheet);
    document.getElementById('open-birthday').addEventListener('click', openDateSheet);
    document.getElementById('open-avatar').addEventListener('click', openAvatarSheet);
    document.getElementById('home-age-go').addEventListener('click', function () { showTab('settings'); });
    nameSheet.addEventListener('click', function (event) {
      if (event.target.closest('[data-cancel]')) closeNameSheet(false);
      else if (event.target.closest('[data-ok]')) closeNameSheet(true);
    });
    avatarSheet.addEventListener('click', function (event) {
      if (event.target.closest('[data-cancel]')) closeAvatarSheet();
    });
    document.getElementById('profile-name').addEventListener('keydown', function (event) {
      if (event.key === 'Enter') {
        event.preventDefault();
        closeNameSheet(true);
      }
    });
    document.addEventListener('keydown', function (event) {
      if (event.key !== 'Escape') return;
      if (nameSheet && !nameSheet.hidden) closeNameSheet(false);
      else if (avatarSheet && !avatarSheet.hidden) closeAvatarSheet();
    });
    document.addEventListener('keydown', trapSheetTab);
    document.getElementById('avatar-file').addEventListener('change', function (event) {
      var file = event.target.files && event.target.files[0];
      event.target.value = '';
      if (!file) return;
      if (!file.type || file.type.indexOf('image/') !== 0) {
        showSettingNote(document.getElementById('settings-saved'), '这张照片读不出来', false);
        return;
      }
      compressAvatar(file).then(function (url) {
        data.profile.avatar = url;
        if (!persist()) return;
        renderProfile();
        showSettingNote(document.getElementById('settings-saved'), '已保存', true);
      }).catch(function () {
        showSettingNote(document.getElementById('settings-saved'), '这张照片读不出来', false);
      });
    });
  }

  function restoreSave(button) {
    if (button._savedTimer) clearTimeout(button._savedTimer);
    button.textContent = '保存';
    button.classList.remove('is-saved');
  }

  function markSaved(button) {
    restoreSave(button);
    button.textContent = '已保存';
    button.classList.add('is-saved');
    button._savedTimer = setTimeout(function () {
      button.textContent = '保存';
      button.classList.remove('is-saved');
    }, 1100);
  }

  function fitFeedType() {
    var select = document.getElementById('feed-type');
    var probe = document.getElementById('feed-type-probe');
    if (!select || !probe) return;
    var option = select.options[select.selectedIndex];
    probe.textContent = option ? option.text : '';
    var width = Math.ceil(probe.getBoundingClientRect().width) + 44;
    if (width < 72) width = 72;
    select.style.width = width + 'px';
  }

  function fitControlInputs(root) {
    var scope = root && root.querySelectorAll ? root : document;
    scope.querySelectorAll('.minute-box input').forEach(function (input) {
      var len = String(input.value || '').length;
      if (len < 1) len = 1;
      if (len > 5) len = 5;
      input.style.width = (len + 0.8) + 'ch';
    });
  }

  function editingNote(kind) {
    if (!editingId || editingKind !== kind) return '';
    var rec = findRecord(editingId);
    return rec && typeof rec.note === 'string' ? rec.note : '';
  }

  function syncFeedFields() {
    var breast = document.querySelector('#form-feed [name="feedType"]').value === 'breast';
    document.getElementById('breast-fields').hidden = !breast;
    document.getElementById('bottle-fields').hidden = breast;
    fitFeedType();
    fitControlInputs(document.getElementById('form-feed'));
  }

  function kindOf(rec) {
    if (!rec) return '';
    if (rec.type === 'feed') return 'feed';
    if (rec.type === 'sleep') return 'sleep';
    return 'diaper';
  }

  function findRecord(id) {
    for (var i = 0; i < data.records.length; i += 1) {
      if (data.records[i].id === id) return data.records[i];
    }
    return null;
  }

  function setTimeValue(input, value) {
    input.value = value || '';
    input.dataset.touched = value ? '1' : '0';
    paintTimeField(input);
  }

  function resetFeedForm() {
    var form = document.getElementById('form-feed');
    form.elements.feedType.value = 'breast';
    syncFeedFields();
    form.elements.leftMin.value = '';
    form.elements.rightMin.value = '';
    form.elements.amountMl.value = '';
    clearTime(form.elements.end);
    stampNow(form.querySelector('[name="time"]'));
    clearFormMessage(form);
    restoreSave(form.querySelector('button[type="submit"]'));
    fitControlInputs(form);
  }

  function resetDiaperForm() {
    var form = document.getElementById('form-diaper');
    form.querySelectorAll('[name="diaperKind"]').forEach(function (el) { el.checked = false; });
    stampNow(form.querySelector('[name="time"]'));
    clearFormMessage(form);
    restoreSave(form.querySelector('button[type="submit"]'));
  }

  function resetSleepForm() {
    var form = document.getElementById('form-sleep');
    clearTime(form.elements.end);
    stampNow(form.querySelector('[name="time"]'));
    clearFormMessage(form);
    restoreSave(form.querySelector('button[type="submit"]'));
  }

  function resetKind(kind) {
    if (kind === 'feed') resetFeedForm();
    else if (kind === 'diaper') resetDiaperForm();
    else if (kind === 'sleep') resetSleepForm();
  }

  function fillFeed(rec) {
    var form = document.getElementById('form-feed');
    setTimeValue(form.querySelector('[name="time"]'), rec.time);
    if (rec.end) setTimeValue(form.elements.end, rec.end);
    else clearTime(form.elements.end);
    form.elements.feedType.value = rec.feedType;
    syncFeedFields();
    form.elements.leftMin.value = rec.feedType === 'breast' ? String(rec.leftMin) : '';
    form.elements.rightMin.value = rec.feedType === 'breast' ? String(rec.rightMin) : '';
    form.elements.amountMl.value = rec.feedType === 'breast' ? '' : String(rec.amountMl);
    clearFormMessage(form);
    restoreSave(form.querySelector('button[type="submit"]'));
    fitControlInputs(form);
  }

  function fillDiaper(rec) {
    var form = document.getElementById('form-diaper');
    setTimeValue(form.querySelector('[name="time"]'), rec.time);
    form.querySelectorAll('[name="diaperKind"]').forEach(function (el) {
      el.checked = el.value === rec.type;
    });
    clearFormMessage(form);
    restoreSave(form.querySelector('button[type="submit"]'));
  }

  function fillSleep(rec) {
    var form = document.getElementById('form-sleep');
    setTimeValue(form.querySelector('[name="time"]'), rec.time);
    if (rec.end) setTimeValue(form.elements.end, rec.end);
    else clearTime(form.elements.end);
    clearFormMessage(form);
    restoreSave(form.querySelector('button[type="submit"]'));
  }

  function fillKind(kind, rec) {
    if (kind === 'feed') fillFeed(rec);
    else if (kind === 'diaper') fillDiaper(rec);
    else fillSleep(rec);
  }

  function startEdit(id) {
    var rec = findRecord(id);
    if (!rec) return;
    var kind = kindOf(rec);
    if (editingKind && editingKind !== kind) resetKind(editingKind);
    editingId = id;
    editingKind = kind;
    showTab('home');
    showKind(kind);
    fillKind(kind, rec);
    var block = document.querySelector('.record-block');
    if (block && block.scrollIntoView) block.scrollIntoView({ block: 'start' });
  }

  function cancelEdit() {
    var kind = editingKind;
    editingId = '';
    editingKind = '';
    showKind(kind || 'feed');
    if (kind) resetKind(kind);
  }

  function deleteRecord(id) {
    if (!id) return;
    var next = removeRecord(data.records, id);
    if (next.length === data.records.length) return;
    var editingThis = editingId === id;
    var kind = editingKind;
    data.records = next;
    persist();
    if (editingThis) {
      editingId = '';
      editingKind = '';
      if (kind) resetKind(kind);
      showKind(kind || 'feed');
    }
    refreshViews();
    setStatus('删掉了');
  }

  function remember(record) {
    var current = editingId ? findRecord(editingId) : null;
    if (current && kindOf(current) === kindOf(record)) {
      var keptId = editingId;
      var draft = normalizeRecord(Object.assign({ id: keptId }, record), new Set());
      if (!draft || draft.id !== keptId) return false;
      var found = false;
      data.records = data.records.map(function (rec) {
        if (rec.id !== keptId) return rec;
        found = true;
        return draft;
      });
      if (!found) return false;
      editingId = '';
      editingKind = '';
      showKind(kindOf(record));
      persist();
      refreshViews();
      return true;
    }
    var seen = usedIds();
    var rec = normalizeRecord(Object.assign({ id: createId(seen) }, record), seen);
    if (!rec) return false;
    data.records.push(rec);
    persist();
    refreshViews();
    return true;
  }

  function bindFeedForm() {
    var form = document.getElementById('form-feed');
    form.addEventListener('input', function () {
      clearFormMessage(form);
      fitControlInputs(form);
    });
    form.querySelector('[name="feedType"]').addEventListener('change', function () {
      syncFeedFields();
      clearFormMessage(form);
    });
    form.addEventListener('submit', function (event) {
      event.preventDefault();
      var save = form.querySelector('button[type="submit"]');
      var result = validateFeedInput({
        time: currentTimeValue(form.querySelector('[name="time"]')),
        end: form.elements.end.value,
        feedType: form.querySelector('[name="feedType"]').value,
        left: form.elements.leftMin.value,
        right: form.elements.rightMin.value,
        amount: form.elements.amountMl.value,
        note: editingNote('feed')
      });
      if (!result.ok) {
        restoreSave(save);
        showFormMessage(form, result.message, false);
        return;
      }
      if (!remember(result.record)) {
        showFormMessage(form, '没保存成', false);
        return;
      }
      form.elements.leftMin.value = '';
      form.elements.rightMin.value = '';
      form.elements.amountMl.value = '';
      clearTime(form.elements.end);
      stampNow(form.querySelector('[name="time"]'));
      clearFormMessage(form);
      fitControlInputs(form);
      markSaved(save);
    });
  }

  function bindDiaperForm() {
    var form = document.getElementById('form-diaper');
    form.addEventListener('input', function () { clearFormMessage(form); });
    form.addEventListener('submit', function (event) {
      event.preventDefault();
      var save = form.querySelector('button[type="submit"]');
      var picked = form.querySelector('[name="diaperKind"]:checked');
      var result = validateDiaperInput({
        kind: picked ? picked.value : '',
        time: currentTimeValue(form.querySelector('[name="time"]')),
        note: editingNote('diaper')
      });
      if (!result.ok) {
        restoreSave(save);
        showFormMessage(form, result.message, false);
        return;
      }
      if (!remember(result.record)) {
        showFormMessage(form, '没保存成', false);
        return;
      }
      form.querySelectorAll('[name="diaperKind"]').forEach(function (el) { el.checked = false; });
      stampNow(form.querySelector('[name="time"]'));
      clearFormMessage(form);
      markSaved(save);
    });
  }

  function bindSleepForm() {
    var form = document.getElementById('form-sleep');
    form.addEventListener('input', function () { clearFormMessage(form); });
    form.addEventListener('submit', function (event) {
      event.preventDefault();
      var save = form.querySelector('button[type="submit"]');
      var result = validateSleepInput({
        start: currentTimeValue(form.querySelector('[name="time"]')),
        end: form.elements.end.value,
        note: editingNote('sleep')
      });
      if (!result.ok) {
        restoreSave(save);
        showFormMessage(form, result.message, false);
        return;
      }
      if (!remember(result.record)) {
        showFormMessage(form, '没保存成', false);
        return;
      }
      clearTime(form.elements.end);
      stampNow(form.querySelector('[name="time"]'));
      clearFormMessage(form);
      markSaved(save);
    });
  }

  // 日期选择器只能落到今天或更早，选中后直接打开那一天。
  function jumpHistory(value) {
    var today = todayKey();
    var next = addDays(value, 0);
    if (!next || next !== value || next > today) {
      document.getElementById('history-date').value = historyDate;
      return;
    }
    historyDate = next;
    renderHistory();
  }

  function exportJson() {
    var payload = sanitize(data);
    var blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    var url = URL.createObjectURL(blob);
    var link = document.createElement('a');
    link.href = url;
    link.download = 'baby-tracker-' + todayKey() + '.json';
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
    setStatus('导出好了');
  }

  // 先读文件，格式不对就不覆盖。格式对了，确认后才整份换掉。
  function importJson(file) {
    var reader = new FileReader();
    reader.onload = function () {
      var parsed;
      try {
        parsed = JSON.parse(String(reader.result).replace(/^\uFEFF/, ''));
      } catch (err) {
        alert('这份 JSON 认不出，没有导入。');
        return;
      }
      if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.records)) {
        alert('这份 JSON 认不出，没有导入。');
        return;
      }
      var keepProfile = !Object.prototype.hasOwnProperty.call(parsed, 'profile');
      var savedProfile = data.profile;
      var next = sanitize(parsed);
      if (keepProfile) next.profile = savedProfile;
      if (parsed.records.length > 0 && next.records.length === 0) {
        alert('里面没有能用的记录，没有覆盖。');
        return;
      }
      if (!confirm('导入会覆盖现有全部记录，确定吗？')) return;
      var skipped = parsed.records.length - next.records.length;
      data = next;
      persist();
      historyDate = todayKey();
      lastSeenToday = historyDate;
      renderProfile();
      refreshViews();
      setStatus(skipped > 0 ? '导入好了，跳过 ' + skipped + ' 条' : '已经换成导入的记录');
    };
    reader.onerror = function () { alert('文件没有读出来。'); };
    reader.readAsText(file);
  }

  function catchUpDay() {
    var today = todayKey();
    if (today === lastSeenToday) return;
    lastSeenToday = today;
    if (historyDate > today) historyDate = today;
    renderProfile();
    refreshViews();
  }

  document.getElementById('tabs').addEventListener('click', function (event) {
    var button = event.target.closest('[data-tab]');
    if (!button) return;
    showTab(button.dataset.tab);
  });

  document.querySelector('.subtabs').addEventListener('click', function (event) {
    var button = event.target.closest('[data-kind]');
    if (!button) return;
    showKind(button.dataset.kind);
  });

  document.getElementById('app').addEventListener('click', function (event) {
    var editBtn = event.target.closest('[data-edit]');
    if (editBtn) {
      closeSwipes();
      startEdit(editBtn.getAttribute('data-edit'));
      return;
    }
    var cancelBtn = event.target.closest('[data-form-cancel]');
    if (cancelBtn) {
      var form = cancelBtn.closest('form');
      var kind = form ? form.dataset.kindPanel : '';
      if (editingId && editingKind === kind) cancelEdit();
      else if (kind) resetKind(kind);
      return;
    }
    var deleteBtn = event.target.closest('[data-delete]');
    if (deleteBtn) deleteRecord(deleteBtn.getAttribute('data-delete'));
  });

  document.addEventListener('pointerdown', function (event) {
    if (!event.target.closest('.log-row')) closeSwipes();
  });

  document.getElementById('prev-day').addEventListener('click', function () {
    historyDate = shiftDate(historyDate, -1, todayKey());
    renderHistory();
  });

  document.getElementById('next-day').addEventListener('click', function () {
    historyDate = shiftDate(historyDate, 1, todayKey());
    renderHistory();
  });

  document.getElementById('history-date').addEventListener('change', function (event) {
    jumpHistory(event.target.value);
  });

  document.getElementById('export-btn').addEventListener('click', exportJson);
  document.getElementById('import-btn').addEventListener('click', function () {
    document.getElementById('import-file').click();
  });
  document.getElementById('import-file').addEventListener('change', function (event) {
    var file = event.target.files && event.target.files[0];
    event.target.value = '';
    if (file) importJson(file);
  });

  window.addEventListener('resize', fitAvatar);

  document.addEventListener('visibilitychange', function () {
    if (document.hidden) return;
    refreshUntouchedTimes();
    catchUpDay();
  });
  window.addEventListener('pageshow', function () {
    refreshUntouchedTimes();
    catchUpDay();
  });
  setInterval(catchUpDay, 30000);

  document.querySelectorAll('.minute-box').forEach(function (box) {
    box.addEventListener('click', function (event) {
      var input = box.querySelector('input');
      if (!input || event.target === input) return;
      input.focus();
    });
  });
  syncFeedFields();
  if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(function () { fitFeedType(); });
  }
  bindFeedForm();
  bindDiaperForm();
  bindSleepForm();
  bindTimeFields();
  bindSettings();
  showKind('feed');
  showTab('home');
  renderToday();
  renderHistory();
})();

window.addEventListener('load', function () {
  if (!('serviceWorker' in navigator)) return;
  try {
    navigator.serviceWorker.register('./sw.js').catch(function () {});
  } catch (err) {}
});
