(function () {
    "use strict";
    var E = window.Etiketten;
    var MAP_KEY = "etiketten.mapping.v1";

    var sheets = null; // [{name, rows}]
    var parsed = null;

    var $ = function (id) {
        return document.getElementById(id);
    };

    function loadMap() {
        try {
            return JSON.parse(localStorage.getItem(MAP_KEY)) || {};
        } catch (e) {
            return {};
        }
    }
    function saveMap(m) {
        try {
            localStorage.setItem(MAP_KEY, JSON.stringify(m));
        } catch (e) {}
    }

    function setStatus(msg, isError) {
        var el = $("status");
        el.textContent = msg || "";
        el.className = "msg" + (isError ? " error" : "");
    }

    // ---- Format select ----
    Object.keys(E.FORMATS).forEach(function (key) {
        var o = document.createElement("option");
        o.value = key;
        o.textContent = E.FORMATS[key].name;
        $("format").appendChild(o);
    });

    // ---- File loading ----
    $("file").addEventListener("change", function (ev) {
        var f = ev.target.files[0];
        if (!f) return;
        var reader = new FileReader();
        reader.onerror = function () {
            setStatus("Bestand kon niet gelezen worden.", true);
        };
        reader.onload = function () {
            try {
                var wb = XLSX.read(reader.result, { type: "array" });
                sheets = wb.SheetNames.map(function (n) {
                    return {
                        name: n,
                        rows: XLSX.utils.sheet_to_json(
                            wb.Sheets[n],
                            { header: 1, raw: true, defval: "" },
                        ),
                    };
                });
                parse();
            } catch (e) {
                sheets = null;
                setStatus(
                    "Dit bestand kon niet geopend worden. Is het een Excel-bestand?",
                    true,
                );
            }
        };
        reader.readAsArrayBuffer(f);
    });

    function parse() {
        var stored = loadMap();
        updateResetButton();
        var extra = {};
        Object.keys(stored).forEach(function (field) {
            extra[field] = [E.norm(stored[field])];
        });
        parsed = E.parseWorkbook(sheets, extra);

        var blocking = parsed.missing;
        renderMapping(blocking);
        if (blocking.length) {
            $("options").hidden = true;
            $("pages").textContent = "";
            setStatus(
                "Niet alle kolommen werden herkend. Kies hieronder welke kolom bij elk veld hoort.",
                true,
            );
            return;
        }
        if (!parsed.lines.length) {
            $("options").hidden = true;
            $("pages").textContent = "";
            setStatus("Geen orderlijnen gevonden in dit bestand.", true);
            return;
        }
        var warns = warnings(parsed.lines);
        setStatus(
            parsed.lines.length +
                " orderlijnen gevonden (blad “" +
                parsed.sheetInfo.lines +
                "”)." +
                (warns.length ? " Let op: " + warns.join(" ") : ""),
        );
        if (warns.length) $("status").className = "msg warn";
        fillDates();
        $("options").hidden = false;
        render();
    }

    function warnings(lines) {
        var noDate = lines.filter(function (l) {
            return !l.pickupKey;
        }).length;
        var noName = lines.filter(function (l) {
            return !l.customer;
        }).length;
        var out = [];
        if (noDate)
            out.push(
                noDate + " zonder afhaaldatum (kolom niet gevonden of leeg).",
            );
        if (noName) out.push(noName + " zonder klantnaam.");
        return out;
    }

    function updateResetButton() {
        $("resetMap").hidden = !Object.keys(loadMap()).length;
    }

    function renderMapping(missing) {
        var box = $("mapping");
        box.textContent = "";
        if (!missing.length) {
            box.hidden = true;
            return;
        }
        box.hidden = false;
        var row = document.createElement("div");
        row.className = "row";
        var chosen = {};
        missing.forEach(function (field) {
            var wrap = document.createElement("label");
            wrap.className = "field";
            wrap.textContent = E.LABELS[field];
            var sel = document.createElement("select");
            var none = document.createElement("option");
            none.value = "";
            none.textContent = "– kies kolom –";
            sel.appendChild(none);
            parsed.headers.forEach(function (h) {
                var o = document.createElement("option");
                o.value = h;
                o.textContent = h;
                sel.appendChild(o);
            });
            sel.addEventListener("change", function () {
                chosen[field] = sel.value;
                btn.disabled = !Object.keys(chosen).some(function (k) {
                    return chosen[k];
                });
            });
            wrap.appendChild(sel);
            row.appendChild(wrap);
        });
        var btn = document.createElement("button");
        btn.type = "button";
        btn.textContent = "Toepassen";
        btn.disabled = true;
        btn.addEventListener("click", function () {
            var m = loadMap();
            Object.keys(chosen).forEach(function (k) {
                if (chosen[k]) m[k] = chosen[k];
            });
            saveMap(m);
            parse();
        });
        row.appendChild(btn);
        box.appendChild(row);
    }

    function fillDates() {
        var sel = $("dateFilter");
        var prev = sel.value;
        sel.textContent = "";
        var all = document.createElement("option");
        all.value = "";
        all.textContent = "Alle datums";
        sel.appendChild(all);
        var seen = {};
        parsed.lines.forEach(function (l) {
            if (l.pickupKey && !seen[l.pickupKey])
                seen[l.pickupKey] = l.pickupText;
        });
        Object.keys(seen)
            .sort()
            .forEach(function (k) {
                var o = document.createElement("option");
                o.value = k;
                o.textContent = seen[k];
                sel.appendChild(o);
            });
        if (seen[prev]) sel.value = prev;
    }

    // ---- Rendering ----
    function el(tag, cls, txt) {
        var e = document.createElement(tag);
        if (cls) e.className = cls;
        if (txt != null) e.textContent = txt;
        return e;
    }
    function mm(n) {
        return n.toFixed(2) + "mm";
    }

    function labelEl(slot, fmt) {
        var l = slot.line;
        var d = el("div", "label" + (fmt.h < 30 ? " small" : ""));
        d.style.left = mm(slot.x);
        d.style.top = mm(slot.y);
        d.style.width = mm(fmt.w);
        d.style.height = mm(fmt.h);

        var prod = el(
            "div",
            "prod",
            (l.qty !== "" ? l.qty + " × " : "") + l.product,
        );
        d.appendChild(prod);

        if (l.variant || l.remark) {
            var sub = el("div", "sub");
            if (l.variant) sub.appendChild(document.createTextNode(l.variant));
            if (l.variant && l.remark)
                sub.appendChild(document.createTextNode(" – "));
            if (l.remark) sub.appendChild(el("span", "remark", l.remark));
            d.appendChild(sub);
        }

        var foot = el("div", "foot");
        var who = el("div", "who");
        who.appendChild(el("b", null, l.customer));
        var meta = el("span");
        var count = el("span", "count", l.index + "/" + l.total);
        count.style.display = "inline";
        meta.appendChild(count);
        var when = [l.pickupText, l.time].filter(Boolean).join(" ");
        if (when) meta.appendChild(document.createTextNode("  " + when));
        who.appendChild(meta);
        foot.appendChild(who);
        foot.appendChild(el("div", "no", l.orderNo));
        d.appendChild(foot);
        return d;
    }

    function render() {
        if (!parsed || !parsed.lines.length) return;
        var fmt = E.FORMATS[$("format").value];
        var dateKey = $("dateFilter").value;
        var lines = parsed.lines.filter(function (l) {
            return !dateKey || l.pickupKey === dateKey;
        });
        lines = E.sortLines(lines, $("sort").value);

        var multi = fmt.cols * fmt.rows > 1;
        $("skipField").hidden = !multi;
        var skip = multi ? Math.max(1, +$("skip").value || 1) - 1 : 0;
        var offX = +$("offX").value || 0;
        var offY = +$("offY").value || 0;
        var pages = E.paginate(lines, fmt, skip, offX, offY);

        var pw = fmt.page ? fmt.page[0] : 210;
        var ph = fmt.page ? fmt.page[1] : 297;
        $("page-style").textContent =
            "@page { size: " + pw + "mm " + ph + "mm; margin: 0; }";

        var host = $("pages");
        host.textContent = "";
        pages.forEach(function (slots) {
            var p = el("div", "page");
            p.style.width = pw + "mm";
            p.style.height = ph + "mm";
            slots.forEach(function (s) {
                p.appendChild(labelEl(s, fmt));
            });
            host.appendChild(p);
        });

        var orders = {};
        lines.forEach(function (l) {
            orders[l.orderKey] = 1;
        });
        $("summary").textContent =
            lines.length +
            " etiketten voor " +
            Object.keys(orders).length +
            " bestellingen op " +
            pages.length +
            (pages.length === 1 ? " blad." : " bladen.");
        $("print").disabled = !lines.length;
    }

    var timer = null;
    function renderSoon() {
        clearTimeout(timer);
        timer = setTimeout(render, 150);
    }
    ["dateFilter", "sort", "format"].forEach(function (id) {
        $(id).addEventListener("input", render);
    });
    ["skip", "offX", "offY"].forEach(function (id) {
        $(id).addEventListener("input", renderSoon);
    });
    $("resetMap").addEventListener("click", function () {
        try {
            localStorage.removeItem(MAP_KEY);
        } catch (e) {}
        updateResetButton();
        if (sheets) parse();
    });
    updateResetButton();
    $("print").addEventListener("click", function () {
        window.print();
    });
})();
