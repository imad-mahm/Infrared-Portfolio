/* ============================================================
   INFRARED TECHNOLOGIES — scroll-triggered reveal + corridor

   1. The hero owns the screen until the mark has assembled.
      The first scroll / swipe / key press plays the FULL reveal
      on its own timeline (it is not scrubbed by scroll position).
   2. Scroll then unlocks and scrubs a "hallway": the assembled mark
      recedes (zooms out) while placeholder project cards appear at the
      sides and recede toward the vanishing point. The cards are real 3D
      meshes rendered by three.js (corridor3d.js); if WebGL is missing we
      fall back to flat 2D boxes here.
   ============================================================ */
(function () {
    "use strict";

    if ("scrollRestoration" in history) history.scrollRestoration = "manual";
    window.scrollTo(0, 0);

    var show = document.getElementById("top");
    var stage = document.querySelector(".stage");
    var svg = document.getElementById("logo");
    var cue = document.getElementById("cue");
    var stem = document.querySelector(".ltr-stem");
    var bowl = document.querySelector(".ltr-bowl");
    var diag = document.querySelector(".ltr-diag");

    var mark = document.querySelector(".mark");
    var corridor = document.querySelector(".corridor");
    var cards = [];
    var lines = document.querySelector(".corridor__lines");
    var label = document.querySelector(".corridor__label");

    /* viewBox framings (same ~0.6 aspect so the zoom-out feels uniform).
       circles: tight on the concentric cluster (centre ~177,177).
       full:    the whole portrait mark with breathing room.            */
    var CIRCLES = [-3, -123, 360, 600];
    var FULL = [-231, -359, 1536, 2560];

    /* Parked positions (viewBox units) — pieces sit outside the clip until
       they slide home. Final position for every piece is translate(0,0).  */
    var STEM_IN_X = -260; /* stem enters from the left            */
    var STEM_OUT_X = 40;  /* ...overshoots slightly right, then nudges left */
    var SIDE_X = 760;     /* bowl + diagonal slide in from the right */

    /* ---- Corridor (flat boxes that recede — no perspective / 3D) ---- */
    var FOCAL = 1.0;       // recede strength: scale = FOCAL / (FOCAL + ZK*u)
    var ZK = 7.5;          // how much a card shrinks across the corridor
    var WALL = 0.42;       // lateral wall offset (fraction of stage width)
    var CARD_STEP = 0.1;   // stagger between successive card entrances (in q)
    var CARD_SPAN = 0.40;  // how much q a card takes to cross the corridor
    var stageW = 0, stageH = 0;

    var clamp = function (v, a, b) {
        a = a === undefined ? 0 : a;
        b = b === undefined ? 1 : b;
        return Math.min(b, Math.max(a, v));
    };
    var lerp = function (a, b, t) { return a + (b - a) * t; };
    var smooth = function (t) { return t * t * (3 - 2 * t); };               // smoothstep
    var easeInOut = function (t) { return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2; };

    /* Render the whole mark for a single progress value p (0 -> 1).
       Pure function of p — the driver below decides what feeds it.        */
    function render(p) {
        /* Zoom out: interpolate the viewBox (resolution-independent). */
        var e = smooth(p);
        var vb = CIRCLES.map(function (c, i) { return lerp(c, FULL[i], e); });
        svg.setAttribute("viewBox", vb.join(" "));

        /* Letterform choreography spans p 0.2 -> 0.9 ------------------------- */
        var lp = clamp((p - 0.2) / 0.7);

        /* Phase 1 (lp 0 -> 0.4): vertical stem slides in from the left. */
        var s1 = smooth(clamp(lp / 0.4));
        /* Phase 2 (lp 0.4 -> 1): stem nudges left while the others arrive. */
        var s2 = smooth(clamp((lp - 0.4) / 0.6));
        /* Diagonal leg is staggered just behind the bowl. */
        var d2 = smooth(clamp((lp - 0.5) / 0.5));

        var stemX = lerp(STEM_IN_X, STEM_OUT_X, s1) + lerp(0, -STEM_OUT_X, s2);
        stem.style.transform = "translate(" + stemX.toFixed(2) + "px,0)";
        bowl.style.transform = "translate(" + lerp(SIDE_X, 0, s2).toFixed(2) + "px,0)";
        diag.style.transform = "translate(" + lerp(SIDE_X, 0, d2).toFixed(2) + "px,0)";

        /* Caption fades in near the end of the reveal. */
        stage.style.setProperty("--wm", clamp((p - 0.6) / 0.3).toFixed(3));
    }

    /* Cache stage size for the corridor projection. */
    function measure() {
        if (!stage) return;
        stageW = stage.clientWidth;
        stageH = stage.clientHeight;
    }

    /* Drive the corridor for progress q (0->1). Flat cards appear at a side,
       shrink + drift toward the centre, then fade. Plain 2D transforms.        */
    function renderCorridor(q) {
        /* The assembled mark recedes (zooms out) and fades as you enter. */
        var lq = smooth(clamp(q / 0.45));
        if (mark) {
            mark.style.transform = "scale(" + lerp(1, 0.14, lq).toFixed(3) + ")";
            mark.style.opacity = (1 - smooth(clamp((q - 0.05) / 0.4))).toFixed(3);
        }

        /* The hero caption clears the moment the corridor starts (only once the
           assembly is finished — during assembly render() owns --wm).          */
        if (state === "done") {
            stage.style.setProperty("--wm", clamp(1 - q / 0.12).toFixed(3));
        }

        /* Hallway guides + section label breathe in across the corridor. */
        var band = smooth(clamp((q - 0.04) / 0.14)) * (1 - smooth(clamp((q - 0.84) / 0.16)));
        if (lines) {
            lines.style.opacity = (0.3 * band).toFixed(3);
            lines.style.transform = "scale(" + (1 + q * 0.7).toFixed(3) + ")";
        }
        if (label) label.style.opacity = band.toFixed(3);

        /* Project cards: true 3D via three.js (corridor3d.js) when it has
           loaded; otherwise the flat 2D fallback below.                    */
        if (window.IR3D) {
            window.IR3D.setProgress(q);
        } else {
            for (var i = 0; i < cards.length; i++) {
                var u = clamp((q - i * CARD_STEP) / CARD_SPAN);
                var s = FOCAL / (FOCAL + ZK * u);         // 1 (near) -> small (far)
                var side = (i % 2 === 0) ? -1 : 1;
                var ox = side * WALL * stageW * s;        // converges to centre as it shrinks
                var oy = 0;
                var fadeU = (i === cards.length - 1) ? 0.45 : 0.88;
                var op = smooth(clamp(u / 0.12)) * (1 - smooth(clamp((u - fadeU) / 0.10)));

                var card = cards[i];
                card.style.transform =
                    "translate(" + ox.toFixed(1) + "px," + oy.toFixed(1) + "px) scale(" + s.toFixed(3) + ")";
                card.style.opacity = op.toFixed(3);
                card.style.zIndex = String(Math.round((1 - u) * 1000)); // nearer on top
            }
        }
    }

    /* Corridor scrub progress from the tall .show track. */
    function corridorProgress() {
        if (!show) return 0;
        var scrollable = show.offsetHeight - window.innerHeight;
        return scrollable > 0 ? clamp(-show.getBoundingClientRect().top / scrollable) : 0;
    }

    /* ----------------------------------------------------------------------
       State machine:  idle  ->  playing  ->  done
       ---------------------------------------------------------------------- */
    var DURATION = 2400;          // length of the full reveal playthrough (ms)
    var INTRO_GATE = 1800;        // wait for the boot bloom before arming scroll
    var state = "idle";
    var introReady = false;
    var pending = false;          // user scrolled before the bloom finished
    var afterFinish = null;       // action to run once the reveal completes

    function lock() {
        document.documentElement.classList.add("intro-lock");
        document.body.classList.add("intro-lock");
    }
    function unlock() {
        document.documentElement.classList.remove("intro-lock");
        document.body.classList.remove("intro-lock");
        document.body.classList.add("intro-done");
    }

    function play() {
        if (state !== "idle") return;
        state = "playing";
        if (cue) cue.style.opacity = "0";

        var start = null;
        function step(ts) {
            if (start === null) start = ts;
            var t = clamp((ts - start) / DURATION);
            render(easeInOut(t));
            if (t < 1) {
                window.requestAnimationFrame(step);
            } else {
                finish();
            }
        }
        window.requestAnimationFrame(step);
    }

    function finish() {
        if (state === "done") return;
        state = "done";
        render(1);
        unlock();
        if (cue) cue.style.opacity = "0";

        /* Hand off to the corridor at q = 0 (seamless from the assembled mark). */
        measure();
        renderCorridor(corridorProgress());

        /* Deferred navigation (e.g. a nav click made during the reveal). */
        if (afterFinish) {
            var fn = afterFinish;
            afterFinish = null;
            window.setTimeout(fn, 60);
        }
    }

    /* Any scroll intent while the hero is on screen plays / skips the reveal,
       and is swallowed so the page can't move underneath it.                 */
    function intercept(e) {
        if (state === "done") return;              // normal scrolling now
        if (e && e.cancelable) e.preventDefault();
        if (state !== "idle") return;
        if (introReady) play();
        else pending = true;                       // armed; fires when bloom ends
    }

    var SCROLL_KEYS = [" ", "Spacebar", "PageDown", "ArrowDown", "End", "Enter"];
    function onKey(e) {
        if (state === "done") return;
        if (SCROLL_KEYS.indexOf(e.key) === -1) return;
        intercept(e);
    }

    /* ----------------------------------------------------------------------
       Boot
       ---------------------------------------------------------------------- */
    var reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    render(0);
    measure();

    if (reduce) {
        /* Skip motion entirely: assembled mark + a plain static project grid. */
        document.body.classList.add("reduced");
        state = "done";
        render(1);
        document.body.classList.add("intro-done");
        if (cue) cue.style.opacity = "0";
    } else {
        renderCorridor(0);                         // park cards off-stage, mark full
        lock();
        window.addEventListener("wheel", intercept, { passive: false });
        window.addEventListener("touchmove", intercept, { passive: false });
        window.addEventListener("keydown", onKey);

        /* Arm the trigger (and reveal the cue) once the boot bloom has played. */
        window.setTimeout(function () {
            if (state !== "idle") return;          // already played / skipped
            introReady = true;
            if (cue) cue.style.opacity = "1";
            if (pending) play();
        }, INTRO_GATE);
    }

    /* Load projects from JSON and build fallback corridor cards. */
    fetch('projects.json')
        .then(function (r) { return r.json(); })
        .then(function (projects) {
            window.IR_PROJECTS = projects;
            if (corridor) {
                projects.forEach(function (p, i) {
                    var a = document.createElement('article');
                    a.className = 'card';
                    a.dataset.i = i;
                    var hasImg = p.img && p.img.length > 0;
                    a.innerHTML = '<div class="card__media">' +
                        (hasImg ? '<img class="card__img" src="" alt="">' : '') +
                        '<span class="card__no"></span></div>' +
                        '<div class="card__body"><h3 class="card__title"></h3><span class="card__tag"></span></div>';
                    if (hasImg) {
                        var img = a.querySelector('.card__img');
                        img.src = p.img;
                        img.alt = p.title;
                    }
                    a.querySelector('.card__no').textContent = p.id;
                    a.querySelector('.card__title').textContent = p.title;
                    a.querySelector('.card__tag').textContent = p.tag;
                    corridor.appendChild(a);
                });
            }
            cards = Array.prototype.slice.call(document.querySelectorAll('.card'));
            if (cards.length > 0) {
                CARD_STEP = 0.80 / cards.length;
                CARD_SPAN = Math.max(1 - (cards.length - 1) * CARD_STEP, 0.25);
            }
            if (show && cards.length > 6) show.style.height = (cards.length * 100) + 'vh';
        });

    /* Corridor scrub — only active once the reveal is done. */
    var cTicking = false;
    function onScroll() {
        if (reduce || state !== "done") return;
        if (!cTicking) {
            window.requestAnimationFrame(function () {
                renderCorridor(corridorProgress());
                cTicking = false;
            });
            cTicking = true;
        }
    }
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", function () {
        measure();
        if (!reduce && state === "done") renderCorridor(corridorProgress());
    });

    /* Nav anchors: if the reveal hasn't played yet, play it first, THEN
       navigate to the target once it finishes.                            */
    document.querySelectorAll('a[href^="#"]').forEach(function (a) {
        a.addEventListener("click", function (e) {
            if (state === "done") return;          // normal anchor scroll
            e.preventDefault();
            var href = a.getAttribute("href");
            var target = (href && href.length > 1) ? document.querySelector(href) : null;
            afterFinish = function () {
                if (target) target.scrollIntoView({ behavior: "smooth" });
            };
            if (state === "idle") {
                if (introReady) play();
                else pending = true;               // armed; plays when bloom ends
            }
        });
    });

    /* Scroll-in for content blocks below the hero. */
    if ("IntersectionObserver" in window) {
        var io = new IntersectionObserver(function (entries) {
            entries.forEach(function (entry) {
                if (entry.isIntersecting) {
                    entry.target.classList.add("is-in");
                    io.unobserve(entry.target);
                }
            });
        }, { threshold: 0.15 });

        document.querySelectorAll(".reveal-up").forEach(function (el) { io.observe(el); });
    } else {
        document.querySelectorAll(".reveal-up").forEach(function (el) { el.classList.add("is-in"); });
    }

    /* ==================================================================
       FEATURE 8: Afterimage — scroll progress ring
       ================================================================== */
    var afterimage = document.getElementById("afterimage");
    var ringCircle = afterimage ? afterimage.querySelector(".afterimage__ring") : null;
    var CIRC = 2 * Math.PI * 17; // ~106.81

    function updateRing() {
        if (!afterimage) return;
        var docH = document.documentElement.scrollHeight - window.innerHeight;
        var p = docH > 0 ? Math.min(window.scrollY / docH, 1) : 0;

        var showAfter = document.querySelector(".manifesto");
        var vis = showAfter && window.scrollY > showAfter.offsetTop - window.innerHeight * 0.5;
        afterimage.classList.toggle("is-visible", !!vis);

        if (ringCircle) {
            ringCircle.style.strokeDashoffset = (CIRC * (1 - p)).toFixed(2);
            var r = Math.round(95 + p * 160);
            var g = Math.round(p * 40);
            var b = Math.round(p * 10);
            ringCircle.style.stroke = "rgb(" + r + "," + g + "," + b + ")";
        }
    }

    /* ==================================================================
       FEATURE 3: Signal Path — SVG stroke draw + node activation
       ================================================================== */
    var processPath = document.querySelector(".process__path");
    var processNodes = document.querySelectorAll(".process__node");
    var processPathLen = 0;

    if (processPath) {
        processPathLen = processPath.getTotalLength();
        processPath.style.strokeDasharray = processPathLen;
        processPath.style.strokeDashoffset = processPathLen;
    }

    function updateProcess() {
        if (!processPath || !processNodes.length) return;
        var section = processPath.closest(".process");
        var rect = section.getBoundingClientRect();
        var vh = window.innerHeight;
        var p = clamp((vh - rect.top) / (vh + rect.height * 0.5));

        processPath.style.strokeDashoffset = (processPathLen * (1 - p)).toFixed(2);

        for (var i = 0; i < processNodes.length; i++) {
            var threshold = 0.25 + (i * 0.55) / (processNodes.length - 1);
            processNodes[i].classList.toggle("is-active", p >= threshold);
        }
    }

    /* ==================================================================
       FEATURE 6: Heat Map — stack cells warm up on scroll
       ================================================================== */
    var stackGrid = document.getElementById("stackGrid");
    var stackCells = stackGrid ? stackGrid.querySelectorAll(".stack__cell") : [];

    function updateStack() {
        if (!stackCells.length) return;
        var rect = stackGrid.getBoundingClientRect();
        var vh = window.innerHeight;
        var p = clamp((vh - rect.top) / (vh * 0.8));

        for (var i = 0; i < stackCells.length; i++) {
            var delay = i / stackCells.length;
            var cellP = clamp((p - delay * 0.5) / 0.5);
            var cell = stackCells[i];
            cell.classList.toggle("is-warm", cellP > 0.3);
            cell.classList.toggle("is-hot", cellP > 0.7);
        }
    }

    /* ==================================================================
       FEATURE 4: Emission Log — typewriter effect
       ================================================================== */
    var typedSet = [];

    document.querySelectorAll(".emission__signal .emission__val").forEach(function (el) {
        var full = el.textContent;
        var cursor = document.createElement("span");
        cursor.className = "emission__cursor";
        el.textContent = "";
        el.appendChild(cursor);
        typedSet.push({ el: el, full: full, started: false, idx: 0, cursor: cursor });
    });

    if ("IntersectionObserver" in window) {
        var emissionObserver = new IntersectionObserver(function (entries) {
            entries.forEach(function (entry) {
                if (!entry.isIntersecting) return;
                emissionObserver.unobserve(entry.target);
                var val = entry.target.querySelector(".emission__signal .emission__val");
                if (!val) return;
                for (var k = 0; k < typedSet.length; k++) {
                    if (typedSet[k].el === val && !typedSet[k].started) {
                        startTyping(typedSet[k]);
                        break;
                    }
                }
            });
        }, { threshold: 0.3 });

        document.querySelectorAll(".emission").forEach(function (em) {
            emissionObserver.observe(em);
        });
    }

    function startTyping(t) {
        t.started = true;
        var speed = 25;
        function tick() {
            if (t.idx >= t.full.length) {
                if (t.cursor) t.cursor.remove();
                return;
            }
            t.el.textContent = t.full.slice(0, t.idx + 1);
            t.el.appendChild(t.cursor);
            t.idx++;
            setTimeout(tick, speed);
        }
        tick();
    }

    /* ==================================================================
       FEATURE 5: Waveform contact canvas
       ================================================================== */
    var waveCanvas = document.getElementById("waveform");
    if (waveCanvas) {
        var wCtx = waveCanvas.getContext("2d");
        var wW, wH;
        var wAmplitude = 0;
        var wPhase = 0;

        function sizeWave() {
            var rect = waveCanvas.parentElement;
            wW = waveCanvas.clientWidth * (window.devicePixelRatio || 1);
            wH = waveCanvas.clientHeight * (window.devicePixelRatio || 1);
            waveCanvas.width = wW;
            waveCanvas.height = wH;
        }
        sizeWave();

        var wRaf = 0;
        function drawWave(ts) {
            wRaf = requestAnimationFrame(drawWave);
            wCtx.clearRect(0, 0, wW, wH);
            wPhase += 0.03;
            wAmplitude *= 0.96;

            var baseAmp = 4 + wAmplitude * 20;
            var mid = wH / 2;
            var step = 3;

            wCtx.beginPath();
            wCtx.moveTo(0, mid);
            for (var x = 0; x < wW; x += step) {
                var n = x / wW;
                var env = Math.sin(n * Math.PI);
                var y = mid + Math.sin(n * 12 + wPhase) * baseAmp * env +
                    Math.sin(n * 24 + wPhase * 1.5) * baseAmp * 0.3 * env;
                wCtx.lineTo(x, y);
            }
            wCtx.strokeStyle = "rgba(255, 0, 0, 0.35)";
            wCtx.lineWidth = 1.5;
            wCtx.stroke();
        }
        /* Only animate the waveform while the contact section is on-screen. */
        function startWave() { if (!wRaf) wRaf = requestAnimationFrame(drawWave); }
        function stopWave() { if (wRaf) { cancelAnimationFrame(wRaf); wRaf = 0; } }
        if ("IntersectionObserver" in window) {
            var waveIO = new IntersectionObserver(function (entries) {
                if (entries[0].isIntersecting) startWave(); else stopWave();
            }, { threshold: 0 });
            waveIO.observe(waveCanvas);
        } else {
            startWave();
        }

        var formInputs = document.querySelectorAll(".contact-form__input");
        formInputs.forEach(function (inp) {
            inp.addEventListener("keydown", function () { wAmplitude = 1; });
            inp.addEventListener("focus", function () { wAmplitude = 0.5; });
        });
    }

    /* Contact form mailto fallback */
    var contactForm = document.getElementById("contactForm");
    if (contactForm) {
        contactForm.addEventListener("submit", function (e) {
            e.preventDefault();
            var name = contactForm.querySelector('[name="name"]').value;
            var email = contactForm.querySelector('[name="email"]').value;
            var msg = contactForm.querySelector('[name="message"]').value;
            var subject = encodeURIComponent("Project enquiry from " + name);
            var body = encodeURIComponent("From: " + name + "\nEmail: " + email + "\n\n" + msg);
            window.location.href = "mailto:imadmahm@gmail.com?subject=" + subject + "&body=" + body;
        });
    }

    /* ==================================================================
       FEATURE 7: Pulse — text scramble on social link hover
       ================================================================== */
    var scrambleChars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%";
    document.querySelectorAll(".pulse__link").forEach(function (link) {
        var original = link.getAttribute("data-text") || link.textContent;
        link.addEventListener("mouseenter", function () {
            var iterations = 0;
            var interval = setInterval(function () {
                link.textContent = original.split("").map(function (ch, i) {
                    if (i < iterations) return original[i];
                    return scrambleChars[Math.floor(Math.random() * scrambleChars.length)];
                }).join("");
                iterations += 1 / 2;
                if (iterations >= original.length) {
                    clearInterval(interval);
                    link.textContent = original;
                }
            }, 40);
        });
    });

    /* ==================================================================
       FEATURE 2: Thermal portrait canvas — isometric voxel heatmap

       A grid of data points (a heat-conduction field) drawn as a field of
       3D cubes in isometric projection. Each cube shows three faces —
       top (lightest), left (medium), right (darkest) — and its height /
       extrusion is proportional to that cell's value.

         · classic 2:1 isometric tiles; cubes drawn back-to-front so they
           occlude correctly;
         · hovering a cube pops it up an extra 12px and highlights its top
           face; each click on a cube raises it one step taller (up to a
           ceiling) and sends out a ripple like the automatic ones;
         · ambient ripples (auto on a timer) only warm the field and fade to
           zero; click-built height relaxes back down slowly. No constant
           source — left alone, everything settles to the resting platform.
       ================================================================== */
    var thermalCanvas = document.getElementById("thermalCanvas");
    if (thermalCanvas && !reduce) {
        var tCtx = thermalCanvas.getContext("2d");

        var COLS = 14;
        var ROWS = 14;                  /* square grid → iso diamond */
        var CELLS = COLS * ROWS;

        /* Double-buffered heat field. grid = current, buf = next. */
        var grid = new Float32Array(CELLS);
        var buf = new Float32Array(CELLS);

        /* Click-built height per cell — separate from the diffusing heat so a
           clicked bar stays a sharp tower. Each click adds CLICK_STEP up to
           HMAX, then it relaxes slowly (STACK_COOL) back down. */
        var stack = new Float32Array(CELLS);
        var HMAX = 3;                   /* tallest a bar can get (value units) */
        var CLICK_STEP = 0.5;           /* height one click adds               */
        var STACK_COOL = 0.0015;        /* per-frame relaxation of click height */

        var DIFFUSE = 0.14;             /* how fast heat spreads to neighbours */
        var COOLING = 0.005;            /* flat heat lost per cell per frame    */

        /* MIN_EXT / EXT_SPAN scale with tile size (set in sizeThermal) so the
           cubes keep their proportions as the element grows. HOVER_POP is a
           fixed 12px lift, as specified. */
        var MIN_EXT = 4;                /* resting cube height (px)            */
        var EXT_SPAN = 28;              /* extra height at value 1 (px)        */
        var HOVER_POP = 12;             /* hovered cube rises this much (px)   */

        /* Display size + iso geometry, refreshed on resize. */
        var W = 0, H = 0, dpr = 1, hw = 1, hh = 1, originX = 0, originY = 0;
        function sizeThermal() {
            var rect = thermalCanvas.getBoundingClientRect();
            var cssW = rect.width || thermalCanvas.clientWidth;
            var cssH = rect.height || thermalCanvas.clientHeight;
            if (!cssW || !cssH) return;
            W = cssW;
            H = cssH;
            dpr = Math.min(window.devicePixelRatio || 1, 2);
            thermalCanvas.width = Math.round(cssW * dpr);
            thermalCanvas.height = Math.round(cssH * dpr);
            tCtx.setTransform(dpr, 0, 0, dpr, 0, 0); /* draw in CSS px */

            hw = W / (COLS + ROWS);     /* iso tile half-width  */
            hh = hw * 0.5;              /* iso tile half-height (2:1) */
            MIN_EXT = hw * 0.3;         /* keep cube proportions at any size */
            EXT_SPAN = hw * 1.7;
            originX = W / 2;
            var diamondH = (COLS - 1 + ROWS - 1) * hh;
            /* Centre vertically, biased down so tall back-row cubes have
               headroom above the diamond. */
            originY = (H - diamondH) / 2 + EXT_SPAN * 0.35;
        }
        sizeThermal();
        window.addEventListener("resize", sizeThermal);

        /* ---- Animated pulses: expanding, fading heat rings --------------- */
        var pulses = [];
        function spawnPulse(gx, gy, maxR, life, strength) {
            pulses.push({ x: gx, y: gy, maxR: maxR, life: life, age: 0, strength: strength });
        }
        /* One ripple at (gx, gy) — same feel whether auto or click-spawned. */
        function spawnRipple(gx, gy) {
            spawnPulse(gx, gy,
                2 + Math.random() * 1.4,    /* small radius → tight pulse */
                800 + Math.random() * 500,
                0.85
            );
        }
        function autoPulse() {
            spawnRipple(Math.random() * COLS, Math.random() * ROWS);
        }

        /* Deposit one frame of a pulse: a soft ring expanding to maxR with a
           warm interior fill, intensity fading as it grows. Additive, so
           overlapping pulses combine — and all of it still cools to zero.   */
        function applyPulse(p) {
            var t = p.age / p.life;
            var ease = 1 - (1 - t) * (1 - t);       /* expand fast, then ease  */
            var ringR = ease * p.maxR;
            var fade = 1 - t;
            var rw = p.maxR * 0.5 + 1;              /* ring thickness          */
            var reach = ringR + rw;
            var minX = Math.max(0, Math.floor(p.x - reach));
            var maxX = Math.min(COLS - 1, Math.ceil(p.x + reach));
            var minY = Math.max(0, Math.floor(p.y - reach));
            var maxY = Math.min(ROWS - 1, Math.ceil(p.y + reach));
            for (var y = minY; y <= maxY; y++) {
                for (var x = minX; x <= maxX; x++) {
                    var dx = x - p.x;
                    var dy = y - p.y;
                    var d = Math.sqrt(dx * dx + dy * dy);
                    var edge = 1 - Math.abs(d - ringR) / rw;
                    if (edge < 0) edge = 0;
                    var fill = d < ringR ? (1 - d / ringR) : 0;
                    var amt = p.strength * fade * (edge * edge * 0.5 + fill * 0.3) * 0.2;
                    if (amt > 0) grid[y * COLS + x] += amt;
                }
            }
        }
        function updatePulses(dt) {
            for (var k = pulses.length - 1; k >= 0; k--) {
                var p = pulses[k];
                p.age += dt;
                if (p.age >= p.life) { pulses.splice(k, 1); continue; }
                applyPulse(p);
            }
        }

        /* One diffusion + cooling step: buf = step(grid), then swap. */
        function step() {
            for (var y = 0; y < ROWS; y++) {
                for (var x = 0; x < COLS; x++) {
                    var i = y * COLS + x;
                    var v = grid[i];
                    var left = x > 0 ? grid[i - 1] : v;
                    var right = x < COLS - 1 ? grid[i + 1] : v;
                    var up = y > 0 ? grid[i - COLS] : v;
                    var down = y < ROWS - 1 ? grid[i + COLS] : v;
                    var avg = (left + right + up + down) * 0.25;
                    var next = v + DIFFUSE * (avg - v) - COOLING;
                    if (next < 0) next = 0;
                    if (next > 1) next = 1;
                    buf[i] = next;
                }
            }
            var tmp = grid;
            grid = buf;
            buf = tmp;

            /* Relax click-built height slowly so towers eventually settle. */
            for (var s = 0; s < CELLS; s++) {
                if (stack[s] > 0) {
                    stack[s] -= STACK_COOL;
                    if (stack[s] < 0) stack[s] = 0;
                }
            }
        }

        /* Displayed value of a cell = diffusing heat + click-built height,
           capped at the height ceiling. Drives both colour and extrusion. */
        function cellVal(i) {
            var v = grid[i] + stack[i];
            return v > HMAX ? HMAX : v;
        }

        /* Dim thermal ramp (faint red → amber, capped below white) so cubes
           glow without blowing out. Cold cells keep a dark-red floor so the
           iso platform stays subtly visible. Writes into rgb[]. */
        var rgb = [0, 0, 0];
        function ramp(h) {
            var r, g, b;
            if (h < 0.35) {
                var t0 = h / 0.35;
                r = 24 + 106 * t0; g = 4 * t0; b = 4;             /* dark red */
            } else if (h < 0.7) {
                var t1 = (h - 0.35) / 0.35;
                r = 130 + 95 * t1; g = 4 + 34 * t1; b = 4;        /* red       */
            } else {
                var t2 = (h - 0.7) / 0.3; if (t2 > 1) t2 = 1;
                r = 225 + 25 * t2; g = 38 + 110 * t2; b = 4 + 41 * t2; /* amber */
            }
            rgb[0] = r; rgb[1] = g; rgb[2] = b;
        }
        function shadeStr(r, g, b, m) {
            r *= m; g *= m; b *= m;
            return "rgb(" + (r > 255 ? 255 : r | 0) + "," + (g > 255 ? 255 : g | 0) + "," + (b > 255 ? 255 : b | 0) + ")";
        }

        /* ---- Isometric cube geometry ------------------------------------ */
        function isoX(col, row) { return originX + (col - row) * hw; }
        function isoY(col, row) { return originY + (col + row) * hh; }

        /* Point-in-convex-quad test (consistent winding → all cross products
           share a sign). Used for hover hit-testing the cube faces.        */
        function inQuad(px, py, x1, y1, x2, y2, x3, y3, x4, y4) {
            var s1 = (x2 - x1) * (py - y1) - (y2 - y1) * (px - x1);
            var s2 = (x3 - x2) * (py - y2) - (y3 - y2) * (px - x2);
            var s3 = (x4 - x3) * (py - y3) - (y4 - y3) * (px - x3);
            var s4 = (x1 - x4) * (py - y4) - (y1 - y4) * (px - x4);
            var hasNeg = s1 < 0 || s2 < 0 || s3 < 0 || s4 < 0;
            var hasPos = s1 > 0 || s2 > 0 || s3 > 0 || s4 > 0;
            return !(hasNeg && hasPos);
        }

        /* Does (mx,my) fall on any visible face of the cube at (col,row)? */
        function hitCube(col, row, h, mx, my) {
            var ext = MIN_EXT + h * EXT_SPAN;
            var cx = isoX(col, row);
            var gy = isoY(col, row);    /* ground centre */
            var ty = gy - ext;          /* top centre    */
            /* top face */
            if (inQuad(mx, my, cx, ty - hh, cx + hw, ty, cx, ty + hh, cx - hw, ty)) return true;
            /* left face */
            if (inQuad(mx, my, cx - hw, ty, cx, ty + hh, cx, gy + hh, cx - hw, gy)) return true;
            /* right face */
            if (inQuad(mx, my, cx, ty + hh, cx + hw, ty, cx + hw, gy, cx, gy + hh)) return true;
            return false;
        }

        /* Mouse / hover state. */
        var mouseX = 0, mouseY = 0, mouseInside = false;
        var hoverCol = -1, hoverRow = -1;
        function updateHover() {
            hoverCol = -1; hoverRow = -1;
            if (!mouseInside) return;
            /* front-to-back so the nearest cube wins the hit */
            for (var row = ROWS - 1; row >= 0; row--) {
                for (var col = COLS - 1; col >= 0; col--) {
                    if (hitCube(col, row, cellVal(row * COLS + col), mouseX, mouseY)) {
                        hoverCol = col; hoverRow = row; return;
                    }
                }
            }
        }

        /* Draw one isometric cube: three faces + thin edge outline. */
        function drawCube(col, row, h, pop) {
            var ext = MIN_EXT + h * EXT_SPAN + pop;
            var cx = isoX(col, row);
            var gy = isoY(col, row);
            var ty = gy - ext;
            ramp(h);
            var r = rgb[0], g = rgb[1], b = rgb[2];
            var hot = pop > 0;          /* hovered → highlight top face */

            /* Left face — medium. */
            tCtx.fillStyle = shadeStr(r, g, b, 0.6);
            tCtx.beginPath();
            tCtx.moveTo(cx - hw, ty); tCtx.lineTo(cx, ty + hh);
            tCtx.lineTo(cx, gy + hh); tCtx.lineTo(cx - hw, gy);
            tCtx.closePath(); tCtx.fill();

            /* Right face — darkest. */
            tCtx.fillStyle = shadeStr(r, g, b, 0.38);
            tCtx.beginPath();
            tCtx.moveTo(cx, ty + hh); tCtx.lineTo(cx + hw, ty);
            tCtx.lineTo(cx + hw, gy); tCtx.lineTo(cx, gy + hh);
            tCtx.closePath(); tCtx.fill();

            /* Top face — lightest (extra-bright when hovered). */
            tCtx.fillStyle = hot ? shadeStr(r + 70, g + 70, b + 50, 1) : shadeStr(r, g, b, 1.05);
            tCtx.beginPath();
            tCtx.moveTo(cx, ty - hh); tCtx.lineTo(cx + hw, ty);
            tCtx.lineTo(cx, ty + hh); tCtx.lineTo(cx - hw, ty);
            tCtx.closePath();
            tCtx.fill();

            /* Edge outline to crisp up the voxel silhouette. */
            tCtx.lineWidth = 1;
            tCtx.strokeStyle = hot ? "rgba(255,230,180,0.9)" : "rgba(0,0,0,0.28)";
            tCtx.stroke();
        }

        /* Draw the whole field back-to-front (row-major = increasing depth). */
        function drawVoxels() {
            tCtx.clearRect(0, 0, W, H);
            tCtx.imageSmoothingEnabled = false;
            for (var row = 0; row < ROWS; row++) {
                for (var col = 0; col < COLS; col++) {
                    var pop = (col === hoverCol && row === hoverRow) ? HOVER_POP : 0;
                    drawCube(col, row, cellVal(row * COLS + col), pop);
                }
            }
        }

        var lastTime = 0;
        var nextPulse = 0;
        var rafId = 0;
        function thermalFrame(now) {
            rafId = requestAnimationFrame(thermalFrame);
            if (!lastTime) lastTime = now;
            var dt = now - lastTime;
            lastTime = now;
            if (dt > 80) dt = 80;       /* clamp tab-switch jumps */

            if (!W || !H) sizeThermal(); /* in case layout wasn't ready at init */

            if (!nextPulse) nextPulse = now + 1200 + Math.random() * 2400;
            if (now >= nextPulse) {
                autoPulse();
                nextPulse = now + 1200 + Math.random() * 2400; /* ~1.2–3.6s */
            }

            updatePulses(dt);
            step();
            if (W && H) drawVoxels();
        }
        /* Run the whole loop (sim + render) only while the canvas is on-screen. */
        function startThermal() {
            if (!rafId) { lastTime = 0; nextPulse = 0; rafId = requestAnimationFrame(thermalFrame); }
        }
        function stopThermal() {
            if (rafId) { cancelAnimationFrame(rafId); rafId = 0; }
        }

        /* Track the cursor in canvas CSS-px space; hover is resolved here on
           move (not every frame) to keep the render loop cheap. */
        function setMouse(e) {
            var rect = thermalCanvas.getBoundingClientRect();
            mouseX = (e.clientX - rect.left) / rect.width * W;
            mouseY = (e.clientY - rect.top) / rect.height * H;
            mouseInside = true;
            updateHover();
        }
        thermalCanvas.addEventListener("mousemove", setMouse);
        thermalCanvas.addEventListener("mouseleave", function () { mouseInside = false; updateHover(); });

        /* Click → raise the hovered bar one step (taller with every click, up
           to HMAX) and send out a ripple like the automatic ones. */
        thermalCanvas.addEventListener("click", function (e) {
            setMouse(e);
            if (hoverCol < 0) return;
            var idx = hoverRow * COLS + hoverCol;
            stack[idx] += CLICK_STEP;
            if (stack[idx] > HMAX) stack[idx] = HMAX;
            spawnRipple(hoverCol + 0.5, hoverRow + 0.5);
        });

        if ("IntersectionObserver" in window) {
            var thermalIO = new IntersectionObserver(function (entries) {
                if (entries[0].isIntersecting) startThermal(); else stopThermal();
            }, { threshold: 0 });
            thermalIO.observe(thermalCanvas);
        } else {
            startThermal();
        }
    }

    /* ==================================================================
       FEATURE 1: Case study expand — click corridor card → overlay
       ================================================================== */
    var casestudy = document.getElementById("casestudy");
    if (casestudy) {
        var csClose = casestudy.querySelector(".casestudy__close");
        var csNo = casestudy.querySelector(".casestudy__no");
        var csTag = casestudy.querySelector(".casestudy__tag");
        var csTitle = casestudy.querySelector(".casestudy__title");
        var csDesc = casestudy.querySelector(".casestudy__desc");

        function openCase(project) {
            csNo.textContent = project.id;
            csTag.textContent = project.tag;
            csTitle.textContent = project.title;
            csDesc.textContent = project.description;
            casestudy.classList.add("is-open");
            casestudy.setAttribute("aria-hidden", "false");
            document.body.style.overflow = "hidden";
        }

        function closeCase() {
            casestudy.classList.remove("is-open");
            casestudy.setAttribute("aria-hidden", "true");
            document.body.style.overflow = "";
        }

        csClose.addEventListener("click", closeCase);
        casestudy.addEventListener("click", function (e) {
            if (e.target === casestudy) closeCase();
        });
        document.addEventListener("keydown", function (e) {
            if (e.key === "Escape" && casestudy.classList.contains("is-open")) closeCase();
        });

        window.IR_OPEN_CASE = openCase;
    }

    /* Combined scroll handler for all features */
    var featureTicking = false;
    function onFeatureScroll() {
        if (featureTicking) return;
        featureTicking = true;
        requestAnimationFrame(function () {
            updateRing();
            updateProcess();
            updateStack();
            featureTicking = false;
        });
    }
    window.addEventListener("scroll", onFeatureScroll, { passive: true });
    onFeatureScroll();

    window.addEventListener("resize", function () {
        if (waveCanvas) sizeWave();
    });
})();
