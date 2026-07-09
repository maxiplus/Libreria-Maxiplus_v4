/* ============================================================
   api.js — Capa de datos Supabase para Maxiplus
   Usa el header "Accept-Profile" / "Content-Profile" para
   acceder a esquemas personalizados (libreria / plasticos)
   ============================================================ */

var SUPA_URL     = "https://uvghoydzpqdnnlghfcvn.supabase.co";
var SUPA_ANON    = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InV2Z2hveWR6cHFkbm5sZ2hmY3ZuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODM0NTcxMzAsImV4cCI6MjA5OTAzMzEzMH0.gaxdyedh8Hnml1_OnsBcBf6Rs-3VV3SLJjPRn_HMpMQ";
var SUPA_SERVICE = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InV2Z2hveWR6cHFkbm5sZ2hmY3ZuIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4MzQ1NzEzMCwiZXhwIjoyMDk5MDMzMTMwfQ.LiOxfZfIXrjUnzy_wZRfPPqj9t47MYxrnsJz9UTsULQ";

// ── Helper base ──────────────────────────────────────────────
function supaFetch(esquema, path, opts, useService) {
  var key = useService ? SUPA_SERVICE : SUPA_ANON;
  var isWrite = opts.method && opts.method !== 'GET';
  var headers = {
    "apikey":           key,
    "Authorization":    "Bearer " + key,
    "Content-Type":     "application/json",
    "Prefer":           "return=representation"
  };
  // Header correcto para esquemas personalizados en Supabase
  if (isWrite) {
    headers["Content-Profile"] = esquema;
  } else {
    headers["Accept-Profile"] = esquema;
  }
  if (opts.headers) Object.assign(headers, opts.headers);
  return fetch(SUPA_URL + "/rest/v1" + path, Object.assign({}, opts, { headers: headers }));
}

function supaGet(esquema, path, useService) {
  return supaFetch(esquema, path, { method: "GET" }, useService)
    .then(function(r) {
      if (!r.ok) return r.text().then(function(t){ throw new Error(t); });
      return r.json();
    });
}

function supaPost(esquema, path, body, useService) {
  return supaFetch(esquema, path, { method: "POST", body: JSON.stringify(body) }, useService)
    .then(function(r) {
      if (!r.ok) return r.text().then(function(t){ throw new Error(t); });
      return r.json();
    });
}

function supaPatch(esquema, path, body, useService) {
  return supaFetch(esquema, path, { method: "PATCH", body: JSON.stringify(body) }, useService)
    .then(function(r) {
      if (!r.ok) return r.text().then(function(t){ throw new Error(t); });
      return r.text().then(function(t){ return t ? JSON.parse(t) : {}; });
    });
}

function supaDelete(esquema, path, useService) {
  return supaFetch(esquema, path, { method: "DELETE" }, useService)
    .then(function(r) { return r.ok; });
}

// ── Normalizadores ───────────────────────────────────────────
function normalizarProducto(p) {
  var imgs = (p.imagenes || "").trim();
  return {
    id:           p.id,
    codigo:       p.codigo,
    nombre:       p.nombre,
    desc:         p.desc_corta,
    detalle:      p.detalle,
    precio:       Number(p.precio),
    stock:        Number(p.stock),
    cat:          p.cat,
    imagenes:     imgs ? imgs.split(",").map(function(s){ return s.trim(); }) : [],
    precio_costo: Number(p.precio_costo || 0),
    precio_oferta: (p.precio_oferta !== null && p.precio_oferta !== undefined)
                    ? Number(p.precio_oferta) : null
  };
}

function normalizarConfig(rows) {
  var cfg = {};
  (rows || []).forEach(function(r){ cfg[r.clave] = r.valor; });
  return {
    descuento_qr_activo:  cfg.descuento_qr_activo === "true",
    descuento_qr_pct:     Number(cfg.descuento_qr_pct  || 10),
    descuento_qr_minimo:  Number(cfg.descuento_qr_minimo || 30),
    mensaje_whatsapp:     cfg.mensaje_whatsapp || "",
    whatsapp_numero:      cfg.whatsapp_numero  || "59174470535",
    admin_usuario:        cfg.admin_usuario    || "",
    admin_clave:          cfg.admin_clave      || "",
    admin_plasticos_url:  cfg.admin_plasticos_url || ""
  };
}

/* ============================================================
   API PÚBLICA — anon key, solo lectura
   ============================================================ */
var API = {

  listar: function(esquema) {
    return Promise.all([
      supaGet(esquema, "/productos?order=id.asc", false),
      supaGet(esquema, "/config?select=clave,valor",  false)
    ]).then(function(res) {
      return {
        productos: res[0].map(normalizarProducto),
        config:    normalizarConfig(res[1])
      };
    });
  },

  buscarPedido: function(esquema, codigo) {
    var hace7 = new Date(Date.now() - 7*24*3600*1000).toISOString();
    return supaGet(
      esquema,
      "/pedidos?codigo_pedido=eq." + encodeURIComponent(codigo) +
      "&creado_en=gte." + hace7 + "&limit=1",
      false
    ).then(function(rows) {
      if (!rows || !rows.length)
        return { ok: false, error: "Código no encontrado o expirado" };
      return { ok: true, pedido: rows[0] };
    });
  },

  comprar: function(esquema, items, codigoPedido, descuentoQr, totalFinal, total) {
    // 1) Leer productos afectados
    var ids = items.map(function(it){ return it.id; }).join(",");
    return supaGet(
      esquema,
      "/productos?id=in.(" + ids + ")&select=id,nombre,stock,precio,precio_oferta,codigo",
      true
    ).then(function(prods) {
      var mapaProds = {};
      prods.forEach(function(p){ mapaProds[p.id] = p; });

      // 2) Verificar stock
      var errores = [];
      items.forEach(function(it) {
        var prod = mapaProds[it.id];
        if (!prod) { errores.push("Producto " + it.id + " no existe"); return; }
        if (prod.stock < it.cantidad)
          errores.push(prod.nombre + ": solo quedan " + prod.stock + " unidades");
      });
      if (errores.length) return { ok: false, error: "Stock insuficiente", detalles: errores };

      // 3) Descontar stock uno por uno
      var updates = items.map(function(it) {
        var prod = mapaProds[it.id];
        return supaPatch(
          esquema,
          "/productos?id=eq." + it.id,
          { stock: prod.stock - it.cantidad },
          true
        );
      });

      // 4) Armar items para guardar
      var itemsGuardados = items.map(function(it) {
        var prod = mapaProds[it.id];
        var precio = (prod.precio_oferta !== null && prod.precio_oferta !== undefined)
          ? Number(prod.precio_oferta) : Number(prod.precio);
        return {
          id:       prod.id,
          codigo:   prod.codigo,
          nombre:   prod.nombre,
          precio:   precio,
          cantidad: it.cantidad,
          subtotal: precio * it.cantidad
        };
      });

      return Promise.all(updates).then(function() {
        // 5) Guardar pedido
        return supaPost(esquema, "/pedidos", {
          codigo_pedido: codigoPedido,
          items:         itemsGuardados,
          total:         total,
          descuento_qr:  descuentoQr || 0,
          total_final:   totalFinal  || total,
          estado:        "pendiente"
        }, true);
      }).then(function() {
        // 6) Devolver productos actualizados
        return supaGet(esquema, "/productos?order=id.asc", false)
          .then(function(p){ return { ok: true, productos: p.map(normalizarProducto) }; });
      });
    }).catch(function(err) {
      console.error("Error en comprar:", err);
      return { ok: false, error: "Error al procesar el pedido" };
    });
  }
};

/* ============================================================
   API ADMIN — service_role key, escritura completa
   ============================================================ */
var ADMIN_API = {

  login: function(esquema, usuario, clave) {
    return supaGet(esquema, "/config?select=clave,valor", true)
      .then(function(rows) {
        var cfg = normalizarConfig(rows);
        if (usuario !== cfg.admin_usuario || clave !== cfg.admin_clave)
          return { ok: false, error: "Usuario o contraseña incorrectos" };
        return { ok: true, config: cfg };
      });
  },

  listarProductos: function(esquema) {
    return supaGet(esquema, "/productos?order=id.asc", true)
      .then(function(rows){ return rows.map(normalizarProducto); });
  },

  guardarProducto: function(esquema, p) {
    return supaPatch(esquema, "/productos?id=eq." + p.id, {
      codigo:        p.codigo,
      nombre:        p.nombre,
      desc_corta:    p.desc,
      detalle:       p.detalle,
      precio:        p.precio,
      stock:         p.stock,
      cat:           p.cat,
      imagenes:      (p.imagenes || []).join(","),
      precio_costo:  p.precio_costo || 0,
      precio_oferta: (p.precio_oferta !== "" && p.precio_oferta !== null && p.precio_oferta !== undefined)
                      ? p.precio_oferta : null
    }, true).then(function(){ return ADMIN_API.listarProductos(esquema); });
  },

  crearProducto: function(esquema, p) {
    return supaPost(esquema, "/productos", {
      codigo:        p.codigo,
      nombre:        p.nombre,
      desc_corta:    p.desc,
      detalle:       p.detalle,
      precio:        p.precio,
      stock:         p.stock,
      cat:           p.cat,
      imagenes:      (p.imagenes || []).join(","),
      precio_costo:  p.precio_costo || 0,
      precio_oferta: (p.precio_oferta !== "" && p.precio_oferta !== null && p.precio_oferta !== undefined)
                      ? p.precio_oferta : null
    }, true).then(function(){ return ADMIN_API.listarProductos(esquema); });
  },

  eliminarProducto: function(esquema, id) {
    return supaDelete(esquema, "/productos?id=eq." + id, true)
      .then(function(){ return ADMIN_API.listarProductos(esquema); });
  },

  listarPedidos: function(esquema) {
    var hace7 = new Date(Date.now() - 7*24*3600*1000).toISOString();
    return supaGet(
      esquema,
      "/pedidos?creado_en=gte." + hace7 + "&order=creado_en.desc",
      true
    );
  },

  aprobarPedido: function(esquema, codigo) {
    return supaPatch(
      esquema,
      "/pedidos?codigo_pedido=eq." + encodeURIComponent(codigo),
      { estado: "aprobado" },
      true
    );
  },

  devolverPedido: function(esquema, codigo, itemsDevolver) {
    return supaGet(
      esquema,
      "/pedidos?codigo_pedido=eq." + encodeURIComponent(codigo) + "&limit=1",
      true
    ).then(function(rows) {
      if (!rows || !rows.length) return { ok: false, error: "Pedido no encontrado" };
      var pedido = rows[0];
      var items  = itemsDevolver || pedido.items;
      var ids    = items.map(function(it){ return it.id; }).join(",");

      return supaGet(esquema, "/productos?id=in.(" + ids + ")&select=id,stock", true)
        .then(function(prods) {
          var mapaStock = {};
          prods.forEach(function(p){ mapaStock[p.id] = p.stock; });

          var updates = items.map(function(it) {
            var stockActual = mapaStock[it.id] || 0;
            return supaPatch(
              esquema,
              "/productos?id=eq." + it.id,
              { stock: stockActual + it.cantidad },
              true
            );
          });

          var esTotal = !itemsDevolver || itemsDevolver.length === pedido.items.length;
          var estadoP = esTotal
            ? supaPatch(esquema, "/pedidos?codigo_pedido=eq." + encodeURIComponent(codigo), { estado: "devuelto" }, true)
            : Promise.resolve();

          return Promise.all([Promise.all(updates), estadoP])
            .then(function(){ return { ok: true }; });
        });
    });
  },

  balance: function(esquema) {
    var hace7 = new Date(Date.now() - 7*24*3600*1000).toISOString();
    return Promise.all([
      supaGet(esquema, "/pedidos?creado_en=gte." + hace7, true),
      supaGet(esquema, "/productos?order=id.asc", true)
    ]).then(function(res) {
      var pedidos = res[0], prods = res[1];
      var costoPorId = {};
      prods.forEach(function(p){ costoPorId[p.id] = Number(p.precio_costo || 0); });

      var totalVendido = 0, totalCosto = 0, ventasPorProd = {};
      pedidos.forEach(function(ped) {
        if (ped.estado === "devuelto") return;
        totalVendido += Number(ped.total_final);
        (ped.items || []).forEach(function(it) {
          totalCosto += (costoPorId[it.id] || 0) * it.cantidad;
          if (!ventasPorProd[it.id])
            ventasPorProd[it.id] = { nombre: it.nombre, unidades: 0, ingresos: 0 };
          ventasPorProd[it.id].unidades += it.cantidad;
          ventasPorProd[it.id].ingresos += it.subtotal;
        });
      });

      var masVendidos = Object.values(ventasPorProd)
        .sort(function(a,b){ return b.unidades - a.unidades; }).slice(0,10);

      var idsConVenta = {};
      pedidos.forEach(function(ped){
        (ped.items||[]).forEach(function(it){ idsConVenta[it.id] = true; });
      });
      var sinMovimiento = prods
        .filter(function(p){ return !idsConVenta[p.id] && p.stock > 0; })
        .map(function(p){ return { id:p.id, nombre:p.nombre, stock:p.stock }; });

      return {
        balance: {
          total_vendido:      totalVendido,
          total_costo:        totalCosto,
          ganancia_neta:      totalVendido - totalCosto,
          pedidos_total:      pedidos.length,
          pedidos_aprobados:  pedidos.filter(function(p){ return p.estado==="aprobado"; }).length,
          pedidos_pendientes: pedidos.filter(function(p){ return p.estado==="pendiente"; }).length
        },
        mas_vendidos:   masVendidos,
        sin_movimiento: sinMovimiento
      };
    });
  },

  guardarConfig: function(esquema, cambios) {
    var updates = Object.keys(cambios).map(function(clave) {
      return supaPatch(
        esquema,
        "/config?clave=eq." + encodeURIComponent(clave),
        { valor: String(cambios[clave]) },
        true
      );
    });
    return Promise.all(updates);
  }
};
