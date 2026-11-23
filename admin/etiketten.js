/*
 * Label logic: parse a "bestellingen" workbook and lay labels out on a sheet.
 * Pure functions, no DOM. Works in the browser (window.Etiketten) and in Node.
 *
 * Columns are found by header name, never by position.
 */
(function (root) {
    "use strict";

    // Logical field -> accepted header names (normalized). First match wins.
    // `multi` fields collect every matching column.
    var FIELDS = {
        orderId: { aliases: ["order id", "orderid", "order-id", "ordernummer"] },
        orderNo: {
            aliases: [
                "bestelnummer",
                "bestelnr",
                "bestelling",
                "bestelling nr",
                "order nr",
                "ordernr",
                "order number",
            ],
        },
        customer: {
            aliases: ["klantnaam", "klant", "naam klant", "klant naam", "customer"],
        },
        pickupDate: {
            aliases: [
                "afhaaldatum/leverdatum",
                "afhaaldatum leverdatum",
                "afhaaldatum",
                "leverdatum",
                "datum",
            ],
        },
        time: { aliases: ["tijdstip", "afhaaltijd", "uur", "tijd"] },
        product: { aliases: ["naam", "product", "productnaam", "artikel"] },
        qty: { aliases: ["aantal", "hoeveelheid", "stuks", "qty"] },
        variant: { aliases: ["prijskeuze", "opties", "variant"], multi: true },
        remark: { aliases: ["opmerking", "opmerkingen", "notitie"] },
    };

    var LABELS = {
        orderId: "Order ID",
        orderNo: "Bestelnummer",
        customer: "Klantnaam",
        pickupDate: "Afhaaldatum",
        time: "Tijdstip",
        product: "Productnaam",
        qty: "Aantal",
        variant: "Prijskeuze / opties",
        remark: "Opmerking",
    };

    // Needed on the lines sheet (or the single flat sheet).
    var REQUIRED = ["product", "qty"];

    function norm(s) {
        return String(s == null ? "" : s)
            .normalize("NFD")
            .replace(/[̀-ͯ]/g, "")
            .toLowerCase()
            .replace(/[^a-z0-9/ ]+/g, " ")
            .replace(/\s+/g, " ")
            .trim();
    }

    // Excel exports use "" (two quote chars) and whitespace for empty cells.
    function clean(v) {
        if (v == null) return "";
        if (v instanceof Date) return v;
        var s = String(v)
            .replace(/\s+/g, " ")
            .trim();
        if (/^["'“”]*$/.test(s)) return "";
        return s;
    }

    function pad(n) {
        return n < 10 ? "0" + n : "" + n;
    }

    // -> { text: "25/11/26", key: "2026-11-25" } or null
    function parseDate(v) {
        var d = null;
        if (v instanceof Date && !isNaN(v)) {
            d = [v.getUTCFullYear(), v.getUTCMonth() + 1, v.getUTCDate()];
        } else if (typeof v === "number" && v > 20000 && v < 80000) {
            var dt = new Date(Math.round((v - 25569) * 86400000));
            d = [dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate()];
        } else if (typeof v === "string") {
            var m = v.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4}|\d{2})(?!\d)/);
            if (m) {
                var y = +m[3];
                if (y < 100) y += 2000;
                d = [y, +m[2], +m[1]];
            } else if ((m = v.match(/^(\d{4})-(\d{2})-(\d{2})/))) {
                d = [+m[1], +m[2], +m[3]];
            }
        }
        if (!d) return null;
        return {
            text: pad(d[2]) + "/" + pad(d[1]) + "/" + pad(d[0] % 100),
            key: d[0] + "-" + pad(d[1]) + "-" + pad(d[2]),
        };
    }

    function parseTime(v) {
        if (v instanceof Date && !isNaN(v)) {
            return pad(v.getUTCHours()) + ":" + pad(v.getUTCMinutes());
        }
        if (typeof v === "number" && v >= 0 && v < 1) {
            var mins = Math.round(v * 1440);
            return pad(Math.floor(mins / 60)) + ":" + pad(mins % 60);
        }
        var m = typeof v === "string" && v.match(/^(\d{1,2})[:.hH](\d{2})/);
        return m ? pad(+m[1]) + ":" + m[2] : typeof v === "string" ? v : "";
    }

    // Find the header row (first row matching >= 2 known headers) and resolve
    // fields. `extra` = user-chosen mappings { field: [normalizedHeader] }.
    function readSheet(rows, extra) {
        extra = extra || {};
        var best = null;
        for (var r = 0; r < Math.min(rows.length, 15); r++) {
            var cols = resolve(rows[r] || [], extra);
            var hits = Object.keys(cols).length;
            if (hits >= 2 && (!best || hits > best.hits)) {
                best = { row: r, cols: cols, hits: hits };
            }
        }
        // No header row recognised: still expose raw headers for mapping.
        var headerRow = best ? best.row : 0;
        return {
            headerRow: headerRow,
            cols: best ? best.cols : {},
            headers: (rows[headerRow] || []).map(clean).filter(function (h) {
                return h !== "";
            }),
            rows: rows.slice(headerRow + 1),
        };
    }

    function resolve(headerCells, extra) {
        var found = {};
        Object.keys(FIELDS).forEach(function (field) {
            var def = FIELDS[field];
            var names = (extra[field] || []).concat(def.aliases);
            var idxs = [];
            names.forEach(function (name) {
                headerCells.forEach(function (h, i) {
                    if (norm(h) === name && idxs.indexOf(i) < 0) idxs.push(i);
                });
            });
            if (idxs.length) found[field] = def.multi ? idxs : idxs[0];
        });
        return found;
    }

    function cell(row, idx) {
        return idx == null ? "" : clean(row[idx]);
    }

    function text(v) {
        return v instanceof Date ? "" : String(v);
    }

    /*
     * sheets: [{ name, rows: [[cell,...],...] }]
     * Returns { lines, missing, headers, sheetInfo }.
     *  - lines: one entry per order line (= one label each)
     *  - missing: logical fields that could not be mapped (blocking ones)
     */
    function parseWorkbook(sheets, extra) {
        var infos = sheets.map(function (s) {
            var info = readSheet(s.rows, extra);
            info.name = s.name;
            return info;
        });

        var allHeaders = [];
        infos.forEach(function (i) {
            i.headers.forEach(function (h) {
                if (allHeaders.indexOf(h) < 0) allHeaders.push(h);
            });
        });

        // Lines sheet: has product + qty. Prefer the one with most rows.
        var linesSheet = infos
            .filter(function (i) {
                return i.cols.product != null && i.cols.qty != null;
            })
            .sort(function (a, b) {
                return b.rows.length - a.rows.length;
            })[0];

        if (!linesSheet) {
            var miss = REQUIRED.filter(function (f) {
                return !infos.some(function (i) {
                    return i.cols[f] != null;
                });
            });
            return {
                lines: [],
                missing: miss.length ? miss : REQUIRED.slice(),
                headers: allHeaders,
            };
        }

        // Orders sheet: any other sheet that has customer and an order key.
        var ordersSheet = infos.filter(function (i) {
            return (
                i !== linesSheet &&
                i.cols.customer != null &&
                (i.cols.orderId != null || i.cols.orderNo != null)
            );
        })[0];

        var lc = linesSheet.cols;
        var missing = [];

        // Order lookup keyed by orderId and by orderNo.
        var byId = {};
        var byNo = {};
        function orderOf(row, cols) {
            return {
                customer: text(cell(row, cols.customer)),
                pickupRaw: cell(row, cols.pickupDate),
                timeRaw: cell(row, cols.time),
                orderNo: text(cell(row, cols.orderNo)),
                orderId: text(cell(row, cols.orderId)),
            };
        }
        if (ordersSheet) {
            ordersSheet.rows.forEach(function (row) {
                var o = orderOf(row, ordersSheet.cols);
                if (o.orderId) byId[o.orderId] = o;
                if (o.orderNo) byNo[o.orderNo] = o;
            });
        }

        var hasOwnCustomer = lc.customer != null;
        if (!hasOwnCustomer && !ordersSheet) missing.push("customer");
        if (lc.orderId == null && lc.orderNo == null) missing.push("orderNo");

        var lines = [];
        linesSheet.rows.forEach(function (row) {
            var product = text(cell(row, lc.product));
            var qty = cell(row, lc.qty);
            if (!product && qty === "") return; // blank row
            var own = orderOf(row, lc);
            var parent =
                (own.orderId && byId[own.orderId]) ||
                (own.orderNo && byNo[own.orderNo]) ||
                {};
            var customer = own.customer || parent.customer || "";
            var pickup = parseDate(
                own.pickupRaw !== "" ? own.pickupRaw : parent.pickupRaw || "",
            );
            var time = parseTime(
                own.timeRaw !== "" ? own.timeRaw : parent.timeRaw || "",
            );
            var variant = (lc.variant || [])
                .map(function (i) {
                    return text(cell(row, i));
                })
                .filter(Boolean)
                .join(" · ");
            var no = own.orderNo || parent.orderNo || own.orderId || "";
            lines.push({
                orderKey: own.orderId || own.orderNo || parent.orderId || no,
                orderNo: no,
                customer: customer,
                pickupText: pickup ? pickup.text : "",
                pickupKey: pickup ? pickup.key : "",
                time: time,
                product: product.replace(/\s+/g, " "),
                qty: qty === "" ? "" : text(qty),
                variant: variant,
                remark: text(cell(row, lc.remark)),
            });
        });

        // n/m = position of the line within its order / lines in that order.
        var totals = {};
        lines.forEach(function (l) {
            totals[l.orderKey] = (totals[l.orderKey] || 0) + 1;
        });
        var seen = {};
        lines.forEach(function (l) {
            seen[l.orderKey] = (seen[l.orderKey] || 0) + 1;
            l.index = seen[l.orderKey];
            l.total = totals[l.orderKey];
        });

        return {
            lines: lines,
            missing: missing,
            headers: allHeaders,
            sheetInfo: {
                lines: linesSheet.name,
                orders: ordersSheet ? ordersSheet.name : null,
            },
        };
    }

    // ---- Sheet layout ------------------------------------------------------

    // All sizes in mm. Page is A4 unless `page` given.
    var FORMATS = {
        "a4-2x8": {
            name: "A4 – 16 labels (2×8), 99,1 × 33,9 mm",
            cols: 2,
            rows: 8,
            w: 99.1,
            h: 33.9,
            left: 4.65,
            top: 12.9,
            gapX: 2.5,
            gapY: 0,
        },
        "a4-3x8": {
            name: "A4 – 24 labels (3×8), 70 × 37,1 mm, zonder marge",
            cols: 3,
            rows: 8,
            w: 70,
            h: 37.125,
            left: 0,
            top: 0,
            gapX: 0,
            gapY: 0,
        },
        "57x32": {
            name: "Labelprinter 57 × 32 mm",
            cols: 1,
            rows: 1,
            w: 57,
            h: 32,
            left: 0,
            top: 0,
            gapX: 0,
            gapY: 0,
            page: [57, 32],
        },
        "102x76": {
            name: "Labelprinter 102 × 76 mm",
            cols: 1,
            rows: 1,
            w: 102,
            h: 76,
            left: 0,
            top: 0,
            gapX: 0,
            gapY: 0,
            page: [102, 76],
        },
    };

    // Distribute labels over pages. `skip` = slots already used on page 1.
    // Returns pages: [[{ line, x, y } | null...]] with positions in mm.
    function paginate(lines, format, skip, offsetX, offsetY) {
        var perPage = format.cols * format.rows;
        skip = Math.max(0, Math.min(perPage - 1, skip || 0));
        var pages = [];
        var slot = skip;
        var page = null;
        lines.forEach(function (line) {
            if (!page || slot >= perPage) {
                page = [];
                pages.push(page);
                slot = pages.length === 1 ? skip : 0;
            }
            var col = slot % format.cols;
            var row = Math.floor(slot / format.cols);
            page.push({
                line: line,
                x: format.left + col * (format.w + format.gapX) + (offsetX || 0),
                y: format.top + row * (format.h + format.gapY) + (offsetY || 0),
            });
            slot++;
        });
        return pages;
    }

    function sortLines(lines, mode) {
        var out = lines.slice();
        var cmp = function (a, b) {
            return String(a).localeCompare(String(b), "nl", {
                numeric: true,
                sensitivity: "base",
            });
        };
        if (mode === "product") {
            out.sort(function (a, b) {
                return cmp(a.product, b.product) || cmp(a.orderNo, b.orderNo);
            });
        } else if (mode === "customer") {
            out.sort(function (a, b) {
                return (
                    cmp(a.customer, b.customer) ||
                    cmp(a.orderNo, b.orderNo) ||
                    a.index - b.index
                );
            });
        }
        return out; // "order": keep file order
    }

    var api = {
        FIELDS: FIELDS,
        LABELS: LABELS,
        FORMATS: FORMATS,
        norm: norm,
        parseWorkbook: parseWorkbook,
        paginate: paginate,
        sortLines: sortLines,
    };
    if (typeof module !== "undefined" && module.exports) module.exports = api;
    else root.Etiketten = api;
})(typeof window !== "undefined" ? window : globalThis);
