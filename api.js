/* ============================================================
   api.js — Capa de datos Supabase para Librería Maxiplus
   Importado por index.html, admin.html, plasticos.html,
   admin-plasticos.html
   ============================================================ */

var SUPA_URL         = "https://uvghoydzpqdnnlghfcvn.supabase.co";
var SUPA_ANON        = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InV2Z2hveWR6cHFkbm5sZ2hmY3ZuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODM0NTcxMzAsImV4cCI6MjA5OTAzMzEzMH0.gaxdyedh8Hnml1_OnsBcBf6Rs-3VV3SLJjPRn_HMpMQ";
var SUPA_SERVICE     = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InV2Z2hveWR6cHFkbm5sZ2hmY3ZuIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4MzQ1NzEzMCwiZXhwIjoyMDk5MDMzMTMwfQ.LiOxfZfIXrjUnzy_wZRfPPqj9t47MYxrnsJz9UTsULQ";

// ── Helper fetch ─────────────────────────────────────────────
function supaFetch(path, opts, useService) {
  var key = useService ? SUPA_SERVICE : SUPA_ANON;
  var headers = Object.assign({
    "apikey":        key,
    "Authorization": "Bearer " + key,
    "Content-Type":  "application/json",
    "Prefer":        "return=representation"
  }, opts.headers || {});
  return fetch(SUPA_URL + path, Object.assign({}, opts, { headers: headers }));
}

function supaGet(path, useService) {
  return supaFetch(path, { method: "GET" }, useService).then(function(r){ return r.json(); });
}

function supaPost(path, body, useService) {
  return supaFetch(path, { method: "POST", body: JSON.stringify(body) }, useService).then(function(r){ return r.json(); });
}

function supaPatch(path, body, useService) {
  return supaFetch(path, { method: "PATCH", body: JSON.stringify(body) }, useService).then(function(r){ return r.json(); });
}

function supaDelete(path, useService) {
  return supaFetch(path, { method: "DELETE" }, useService).then(function(r){ return r.ok; });
}

// ── Normalizar producto desde DB ──────────────────────────────
function normalizarProducto(p) {
  var imgs = (p.imagenes || "").trim();
  return {
    id:            p.id,
    codigo:        p.codigo,
    nombre:        p.nombre,
    desc:          p.desc_corta,
    detalle:       p.detalle,
    precio:        Number(p.precio),
    stock:         Number(p.stock),
    cat:           p.cat,
    imagenes:      imgs ? imgs.split(",").map(function(s){ return s.trim(); }) : [],
    precio_costo:  Number(p.precio_costo || 0),
    precio_oferta: p.precio_oferta !== null && p.precio_oferta !== undefined ? Number(p.precio_oferta) : null
  };
}

// ── Normalizar config desde DB (array de {clave,valor}) ───────
function normalizarConfig(rows) {
  var cfg = {};
  rows.forEach(function(r){ cfg[r.clave] = r.valor; });
  return {
    descuento_qr_activo:  cfg.descuento_qr_activo === "true",
    descuento_qr_pct:     Number(cfg.descuento_qr_pct || 10),
    descuento_qr_minimo:  Number(cfg.descuento_qr_minimo || 30),
    mensaje_whatsapp:     cfg.mensaje_whatsapp || "",
    whatsapp_numero:      cfg.whatsapp_numero  || "59174470535",
    admin_usuario:        cfg.admin_usuario    || "",
    admin_clave:          cfg.admin_clave      || "",
    admin_plasticos_url:  cfg.admin_plasticos_url || ""
  };
}

/* ============================================================
   API PÚBLICA (usa anon key — solo lectura)
   ============================================================ */
var API = {

  // Listar productos + config
  listar: function(esquema) {
    return Promise.all([
      supaGet("/rest/v1/" + esquema + "__productos?order=id.asc", false),
      supaGet("/rest/v1/" + esquema + "__config?select=clave,valor",  false)
    ]).then(function(results) {
      return {
        productos: results[0].map(normalizarProducto),
        config:    normalizarConfig(results[1])
      };
    });
  },

  // Buscar pedido por código (últimos 7 días)
  buscarPedido: function(esquema, codigo) {
    var hace7 = new Date(Date.now() - 7*24*3600*1000).toISOString();
    return supaGet(
      "/rest/v1/" + esquema + "__pedidos?codigo_pedido=eq." + encodeURIComponent(codigo) +
      "&creado_en=gte." + hace7 + "&limit=1", false
    ).then(function(rows) {
      if (!rows || !rows.length) return { ok: false, error: "Código no encontrado o expirado" };
      return { ok: true, pedido: rows[0] };
    });
  },

  // Comprar: descuenta stock y guarda pedido (usa service_role)
  comprar: function(esquema, items, codigoPedido, descuentoQr, totalFinal, total) {
    // 1) Verificar stock y descontar uno por uno en paralelo
    var checks = items.map(function(it) {
      return supaGet("/rest/v1/" + esquema + "__productos?id=eq." + it.id + "&select=id,nombre,stock,precio,precio_oferta,codigo", true)
        .then(function(rows) { return { it: it, prod: rows[0] }; });
    });

    return Promise.all(checks).then(function(resultados) {
      var errores = [];
      resultados.forEach(function(r) {
        if (!r.prod) { errores.push("Producto " + r.it.id + " no existe"); return; }
        if (r.prod.stock < r.it.cantidad) errores.push(r.prod.nombre + ": solo quedan " + r.prod.stock + " unidades");
      });
      if (errores.length) return { ok: false, error: "Stock insuficiente", detalles: errores };

      // 2) Descontar stock
      var updates = resultados.map(function(r) {
        return supaPatch(
          "/rest/v1/" + esquema + "__productos?id=eq." + r.prod.id,
          { stock: r.prod.stock - r.it.cantidad }, true
        );
      });

      // 3) Armar items para guardar en pedido
      var itemsGuardados = resultados.map(function(r) {
        var precio = r.prod.precio_oferta !== null ? Number(r.prod.precio_oferta) : Number(r.prod.precio);
        return {
          id:       r.prod.id,
          codigo:   r.prod.codigo,
          nombre:   r.prod.nombre,
          precio:   precio,
          cantidad: r.it.cantidad,
          subtotal: precio * r.it.cantidad
        };
      });

      return Promise.all(updates).then(function() {
        // 4) Guardar pedido
        return supaPost("/rest/v1/" + esquema + "__pedidos", {
          codigo_pedido: codigoPedido,
          items:         itemsGuardados,
          total:         total,
          descuento_qr:  descuentoQr || 0,
          total_final:   totalFinal  || total,
          estado:        "pendiente"
        }, true).then(function() {
          // 5) Devolver productos actualizados
          return supaGet("/rest/v1/" + esquema + "__productos?order=id.asc", false)
            .then(function(prods) { return { ok: true, productos: prods.map(normalizarProducto) }; });
        });
      });
    });
  }
};

/* ============================================================
   API ADMIN (usa service_role — escritura completa)
   ============================================================ */
var ADMIN_API = {

  // Login: verifica usuario/clave contra la tabla config
  login: function(esquema, usuario, clave) {
    return supaGet("/rest/v1/" + esquema + "__config?select=clave,valor", true)
      .then(function(rows) {
        var cfg = normalizarConfig(rows);
        if (usuario !== cfg.admin_usuario || clave !== cfg.admin_clave)
          return { ok: false, error: "Usuario o contraseña incorrectos" };
        return { ok: true, config: cfg };
      });
  },

  // Listar productos (admin ve precio_costo también)
  listarProductos: function(esquema) {
    return supaGet("/rest/v1/" + esquema + "__productos?order=id.asc", true)
      .then(function(rows) { return rows.map(normalizarProducto); });
  },

  // Guardar producto existente
  guardarProducto: function(esquema, p) {
    return supaPatch("/rest/v1/" + esquema + "__productos?id=eq." + p.id, {
      codigo:        p.codigo,
      nombre:        p.nombre,
      desc_corta:    p.desc,
      detalle:       p.detalle,
      precio:        p.precio,
      stock:         p.stock,
      cat:           p.cat,
      imagenes:      (p.imagenes || []).join(","),
      precio_costo:  p.precio_costo || 0,
      precio_oferta: p.precio_oferta !== "" && p.precio_oferta !== null && p.precio_oferta !== undefined ? p.precio_oferta : null
    }, true).then(function() {
      return ADMIN_API.listarProductos(esquema);
    });
  },

  // Crear producto nuevo
  crearProducto: function(esquema, p) {
    return supaPost("/rest/v1/" + esquema + "__productos", {
      codigo:        p.codigo,
      nombre:        p.nombre,
      desc_corta:    p.desc,
      detalle:       p.detalle,
      precio:        p.precio,
      stock:         p.stock,
      cat:           p.cat,
      imagenes:      (p.imagenes || []).join(","),
      precio_costo:  p.precio_costo || 0,
      precio_oferta: p.precio_oferta !== "" && p.precio_oferta !== null && p.precio_oferta !== undefined ? p.precio_oferta : null
    }, true).then(function() {
      return ADMIN_API.listarProductos(esquema);
    });
  },

  // Eliminar producto
  eliminarProducto: function(esquema, id) {
    return supaDelete("/rest/v1/" + esquema + "__productos?id=eq." + id, true)
      .then(function() { return ADMIN_API.listarProductos(esquema); });
  },

  // Listar pedidos (últimos 7 días)
  listarPedidos: function(esquema) {
    var hace7 = new Date(Date.now() - 7*24*3600*1000).toISOString();
    return supaGet(
      "/rest/v1/" + esquema + "__pedidos?creado_en=gte." + hace7 + "&order=creado_en.desc", true
    );
  },

  // Aprobar pedido
  aprobarPedido: function(esquema, codigo) {
    return supaPatch(
      "/rest/v1/" + esquema + "__pedidos?codigo_pedido=eq." + encodeURIComponent(codigo),
      { estado: "aprobado" }, true
    );
  },

  // Devolver pedido (parcial o total) a stock
  devolverPedido: function(esquema, codigo, itemsDevolver) {
    // 1) Buscar el pedido para saber qué devolver
    return supaGet(
      "/rest/v1/" + esquema + "__pedidos?codigo_pedido=eq." + encodeURIComponent(codigo) + "&limit=1", true
    ).then(function(rows) {
      if (!rows || !rows.length) return { ok: false, error: "Pedido no encontrado" };
      var pedido = rows[0];
      var items  = itemsDevolver || pedido.items;

      // 2) Devolver stock producto por producto
      var updates = items.map(function(it) {
        return supaGet("/rest/v1/" + esquema + "__productos?id=eq." + it.id + "&select=id,stock", true)
          .then(function(prods) {
            if (!prods || !prods.length) return;
            return supaPatch(
              "/rest/v1/" + esquema + "__productos?id=eq." + it.id,
              { stock: prods[0].stock + it.cantidad }, true
            );
          });
      });

      // 3) Si es devolución total, marcar como devuelto
      var estadoPromise = (!itemsDevolver || itemsDevolver.length === pedido.items.length)
        ? supaPatch("/rest/v1/" + esquema + "__pedidos?codigo_pedido=eq." + encodeURIComponent(codigo), { estado: "devuelto" }, true)
        : Promise.resolve();

      return Promise.all([Promise.all(updates), estadoPromise])
        .then(function() { return { ok: true }; });
    });
  },

  // Balance
  balance: function(esquema) {
    var hace7 = new Date(Date.now() - 7*24*3600*1000).toISOString();
    return Promise.all([
      supaGet("/rest/v1/" + esquema + "__pedidos?creado_en=gte." + hace7, true),
      supaGet("/rest/v1/" + esquema + "__productos?order=id.asc", true)
    ]).then(function(results) {
      var pedidos  = results[0];
      var prods    = results[1];
      var costoPorId = {};
      prods.forEach(function(p){ costoPorId[p.id] = Number(p.precio_costo || 0); });

      var totalVendido = 0, totalCosto = 0;
      var ventasPorProd = {};

      pedidos.forEach(function(ped) {
        if (ped.estado === "devuelto") return;
        totalVendido += Number(ped.total_final);
        (ped.items || []).forEach(function(it) {
          totalCosto += (costoPorId[it.id] || 0) * it.cantidad;
          if (!ventasPorProd[it.id]) ventasPorProd[it.id] = { nombre: it.nombre, unidades: 0, ingresos: 0 };
          ventasPorProd[it.id].unidades += it.cantidad;
          ventasPorProd[it.id].ingresos += it.subtotal;
        });
      });

      var masVendidos = Object.values(ventasPorProd)
        .sort(function(a,b){ return b.unidades - a.unidades; }).slice(0,10);

      var idsConVenta = {};
      pedidos.forEach(function(ped){ (ped.items||[]).forEach(function(it){ idsConVenta[it.id]=true; }); });
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

  // Guardar configuración
  guardarConfig: function(esquema, cambios) {
    var updates = Object.keys(cambios).map(function(clave) {
      return supaPatch(
        "/rest/v1/" + esquema + "__config?clave=eq." + encodeURIComponent(clave),
        { valor: String(cambios[clave]) }, true
      );
    });
    return Promise.all(updates);
  }
};
