class ValorCountdownTimer extends HTMLElement {
  connectedCallback() {
    if (this.initialized) return;
    this.initialized = true;

    this.daysEl = this.querySelector("[data-countdown-days]");
    this.hoursEl = this.querySelector("[data-countdown-hours]");
    this.minutesEl = this.querySelector("[data-countdown-minutes]");
    this.secondsEl = this.querySelector("[data-countdown-seconds]");
    this.expiredEl = this.querySelector("[data-countdown-expired]");
    this.timerEl = this.querySelector("[data-countdown-values]");
    this.targetDate = this.parseTargetDate();

    if (!this.targetDate) {
      this.handleExpired();
      return;
    }

    this.update();
    this.interval = window.setInterval(() => this.update(), 1000);
  }

  disconnectedCallback() {
    if (this.interval) {
      window.clearInterval(this.interval);
    }
  }

  parseTargetDate() {
    const date = (this.dataset.endDate || "").trim();
    const time = (this.dataset.endTime || "23:59").trim();
    const offset = (this.dataset.timezoneOffset || "+00:00").trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
    if (!/^\d{2}:\d{2}$/.test(time)) return null;
    if (!/^[+-]\d{2}:\d{2}$/.test(offset)) return null;

    const target = new Date(`${date}T${time}:00${offset}`);
    return Number.isNaN(target.getTime()) ? null : target;
  }

  update() {
    const diff = this.targetDate.getTime() - Date.now();
    if (diff <= 0) {
      this.handleExpired();
      return;
    }

    const totalSeconds = Math.floor(diff / 1000);
    const days = Math.floor(totalSeconds / 86400);
    const hours = Math.floor((totalSeconds % 86400) / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;

    this.setValue(this.daysEl, days);
    this.setValue(this.hoursEl, hours);
    this.setValue(this.minutesEl, minutes);
    this.setValue(this.secondsEl, seconds);
  }

  setValue(element, value) {
    if (!element) return;
    element.textContent = String(value).padStart(2, "0");
  }

  handleExpired() {
    if (this.interval) {
      window.clearInterval(this.interval);
      this.interval = null;
    }

    if (this.dataset.expiredBehavior === "hide") {
      this.hidden = true;
      return;
    }

    if (this.timerEl) this.timerEl.hidden = true;
    if (this.expiredEl) this.expiredEl.hidden = false;
  }
}

if (typeof customElements !== "undefined" && !customElements.get("valor-countdown-timer")) {
  customElements.define("valor-countdown-timer", ValorCountdownTimer);
}
