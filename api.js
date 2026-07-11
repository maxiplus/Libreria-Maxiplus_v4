/* ============================================================
   api.js — Supabase, esquema public con prefijos lib_ / pla_
   ============================================================ */

var SUPA_URL     = "https://expjoorjhmtdznkigigg.supabase.co";
var SUPA_ANON    = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImV4cGpvb3JqaG10ZHpua2lnaWdnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODM2MjYyNzQsImV4cCI6MjA5OTIwMjI3NH0.VOpbphkuH0q-iiR-AGAUQxrXsG9ggXzIf-Ls4NWg8Sc";
var SUPA_SERVICE = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImV4cGpvb3JqaG10ZHpua2lnaWdnIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4MzYyNjI3NCwiZXhwIjoyMDk5MjAyMjc0fQ.H57DpTsAjKJ7aHZpd4uls-wcL1nksQvcCuAL-KC3qr4";

// Devuelve el prefijo de tabla según el esquema
function pfx(esquema) { return esquema === "libreria" ? "lib_" : "pla_"; }

// ── Helpers ──────────────────────────────────────────────────
function hdr(useService) {
  var key = useService ? SUPA_SERVICE : SUPA_ANON;
  return {
    "apikey":        key,
    "Authorization": "Bearer " + key,
    "Content-Type":  "application/json",
    "Prefer":        "return=representation"
  };
}

function sGet(path, useService) {
  return fetch(SUPA_URL + "/rest/v1" + path, { method:"GET", headers:hdr(useService) })
    .then(function(r){ return r.ok ? r.json() : r.json().then(function(e){ throw new Error(e.message||JSON.stringify(e)); }); });
}

function sPost(path, body, useService) {
  return fetch(SUPA_URL + "/rest/v1" + path, { method:"POST", headers:hdr(useService), body:JSON.stringify(body) })
    .then(function(r){ return r.ok ? r.json() : r.json().then(function(e){ throw new Error(e.message||JSON.stringify(e)); }); });
}

function sPatch(path, body, useService) {
  return fetch(SUPA_URL + "/rest/v1" + path, { method:"PATCH", headers:hdr(useService), body:JSON.stringify(body) })
    .then(function(r){ return r.ok ? r.text().then(function(t){ return t?JSON.parse(t):{};}) : r.json().then(function(e){ throw new Error(e.message||JSON.stringify(e)); }); });
}

function sDel(path, useService) {
  return fetch(SUPA_URL + "/rest/v1" + path, { method:"DELETE", headers:hdr(useService) })
    .then(function(r){ return r.ok; });
}

// ── Normalizadores ───────────────────────────────────────────
function normProd(p) {
  var imgs = (p.imagenes||"").trim();
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
    precio_costo: Number(p.precio_costo||0),
    precio_oferta:     (p.precio_oferta!==null&&p.precio_oferta!==undefined) ? Number(p.precio_oferta) : null,
    modo_precio:       p.modo_precio||'manual',
    precio_compra_bs:  p.precio_compra_bs ? Number(p.precio_compra_bs) : null,
    precio_compra_usd: p.precio_compra_usd ? Number(p.precio_compra_usd) : null,
    tc_compra:         p.tc_compra ? Number(p.tc_compra) : null,
    precio_minimo:     p.precio_minimo ? Number(p.precio_minimo) : null
  };
}

function normCfg(rows) {
  var c={};
  (rows||[]).forEach(function(r){ c[r.clave]=r.valor; });
  return {
    descuento_qr_activo: c.descuento_qr_activo==="true",
    descuento_qr_pct:    Number(c.descuento_qr_pct||10),
    descuento_qr_minimo: Number(c.descuento_qr_minimo||30),
    mensaje_whatsapp:    c.mensaje_whatsapp||"",
    whatsapp_numero:     c.whatsapp_numero||"59174470535",
    admin_usuario:       c.admin_usuario||"",
    admin_clave:         c.admin_clave||"",
    admin_plasticos_url: c.admin_plasticos_url||""
  };
}

/* ============================================================
   API PÚBLICA
   ============================================================ */
var API = {

  listar: function(esquema) {
    var p = pfx(esquema);
    return Promise.all([
      sGet("/"+p+"productos?order=id.asc", false),
      sGet("/"+p+"config?select=clave,valor", false)
    ]).then(function(r){
      return { productos: r[0].map(normProd), config: normCfg(r[1]) };
    });
  },

  buscarPedido: function(esquema, codigo) {
    var p = pfx(esquema);
    var hace7 = new Date(Date.now()-7*24*3600*1000).toISOString();
    return sGet("/"+p+"pedidos?codigo_pedido=eq."+encodeURIComponent(codigo)+"&creado_en=gte."+hace7+"&limit=1", false)
      .then(function(rows){
        if(!rows||!rows.length) return {ok:false,error:"Código no encontrado o expirado"};
        return {ok:true,pedido:rows[0]};
      });
  },

  comprar: function(esquema, items, codigoPedido, descuentoQr, totalFinal, total) {
    var p = pfx(esquema);
    var ids = items.map(function(it){ return it.id; }).join(",");
    return sGet("/"+p+"productos?id=in.("+ids+")&select=id,nombre,stock,precio,precio_oferta,codigo", true)
      .then(function(prods){
        var mapa={};
        prods.forEach(function(pr){ mapa[pr.id]=pr; });

        var errores=[];
        items.forEach(function(it){
          var pr=mapa[it.id];
          if(!pr){ errores.push("Producto "+it.id+" no existe"); return; }
          if(pr.stock<it.cantidad) errores.push(pr.nombre+": solo quedan "+pr.stock+" unidades");
        });
        if(errores.length) return {ok:false,error:"Stock insuficiente",detalles:errores};

        var updates = items.map(function(it){
          var pr=mapa[it.id];
          return sPatch("/"+p+"productos?id=eq."+it.id, {stock:pr.stock-it.cantidad}, true);
        });

        var itemsG = items.map(function(it){
          var pr=mapa[it.id];
          var precio=(pr.precio_oferta!==null&&pr.precio_oferta!==undefined)?Number(pr.precio_oferta):Number(pr.precio);
          return {id:pr.id,codigo:pr.codigo,nombre:pr.nombre,precio:precio,cantidad:it.cantidad,subtotal:precio*it.cantidad};
        });

        return Promise.all(updates).then(function(){
          return sPost("/"+p+"pedidos", {
            codigo_pedido:codigoPedido, items:itemsG,
            total:total, descuento_qr:descuentoQr||0,
            total_final:totalFinal||total, estado:"pendiente"
          }, true);
        }).then(function(){
          return sGet("/"+p+"productos?order=id.asc", false)
            .then(function(prs){ return {ok:true,productos:prs.map(normProd)}; });
        });
      }).catch(function(err){
        console.error("Error comprar:",err);
        return {ok:false,error:"Error al procesar el pedido"};
      });
  }
};

/* ============================================================
   API ADMIN
   ============================================================ */
var ADMIN_API = {

  login: function(esquema, usuario, clave) {
    var p=pfx(esquema);
    return sGet("/"+p+"config?select=clave,valor", true)
      .then(function(rows){
        var cfg=normCfg(rows);
        if(usuario!==cfg.admin_usuario||clave!==cfg.admin_clave)
          return {ok:false,error:"Usuario o contraseña incorrectos"};
        return {ok:true,config:cfg};
      });
  },

  listarProductos: function(esquema) {
    return sGet("/"+pfx(esquema)+"productos?order=id.asc", true)
      .then(function(rows){ return rows.map(normProd); });
  },

  guardarProducto: function(esquema, p) {
    var pr=pfx(esquema);
    return sPatch("/"+pr+"productos?id=eq."+p.id, {
      codigo:p.codigo, nombre:p.nombre, desc_corta:p.desc, detalle:p.detalle,
      precio:p.precio, stock:p.stock, cat:p.cat,
      imagenes:(p.imagenes||[]).join(","),
      precio_costo:p.precio_costo||0,
      precio_oferta:(p.precio_oferta!==""&&p.precio_oferta!==null&&p.precio_oferta!==undefined)?p.precio_oferta:null,
      modo_precio:       p.modo_precio||'manual',
      precio_compra_bs:  p.precio_compra_bs||null,
      precio_compra_usd: p.precio_compra_usd||null,
      tc_compra:         p.tc_compra||null,
      precio_minimo:     p.precio_minimo||null
    }, true).then(function(){ return ADMIN_API.listarProductos(esquema); });
  },

  crearProducto: function(esquema, p) {
    var pr=pfx(esquema);
    return sPost("/"+pr+"productos", {
      codigo:p.codigo, nombre:p.nombre, desc_corta:p.desc, detalle:p.detalle,
      precio:p.precio, stock:p.stock, cat:p.cat,
      imagenes:(p.imagenes||[]).join(","),
      precio_costo:p.precio_costo||0,
      precio_oferta:(p.precio_oferta!==""&&p.precio_oferta!==null&&p.precio_oferta!==undefined)?p.precio_oferta:null,
      modo_precio:       p.modo_precio||'manual',
      precio_compra_bs:  p.precio_compra_bs||null,
      precio_compra_usd: p.precio_compra_usd||null,
      tc_compra:         p.tc_compra||null,
      precio_minimo:     p.precio_minimo||null
    }, true).then(function(){ return ADMIN_API.listarProductos(esquema); });
  },

  eliminarProducto: function(esquema, id) {
    return sDel("/"+pfx(esquema)+"productos?id=eq."+id, true)
      .then(function(){ return ADMIN_API.listarProductos(esquema); });
  },

  listarPedidos: function(esquema) {
    var hace7=new Date(Date.now()-7*24*3600*1000).toISOString();
    return sGet("/"+pfx(esquema)+"pedidos?creado_en=gte."+hace7+"&order=creado_en.desc", true);
  },

  aprobarPedido: function(esquema, codigo) {
    return sPatch("/"+pfx(esquema)+"pedidos?codigo_pedido=eq."+encodeURIComponent(codigo), {estado:"aprobado"}, true);
  },

  devolverPedido: function(esquema, codigo, itemsDevolver) {
    var pr=pfx(esquema);
    return sGet("/"+pr+"pedidos?codigo_pedido=eq."+encodeURIComponent(codigo)+"&limit=1", true)
      .then(function(rows){
        if(!rows||!rows.length) return {ok:false,error:"Pedido no encontrado"};
        var pedido=rows[0];
        var items=itemsDevolver||pedido.items;
        var ids=items.map(function(it){ return it.id; }).join(",");
        return sGet("/"+pr+"productos?id=in.("+ids+")&select=id,stock", true)
          .then(function(prods){
            var mapaStock={};
            prods.forEach(function(p){ mapaStock[p.id]=p.stock; });
            var updates=items.map(function(it){
              return sPatch("/"+pr+"productos?id=eq."+it.id, {stock:(mapaStock[it.id]||0)+it.cantidad}, true);
            });
            var esTotal=!itemsDevolver||itemsDevolver.length===pedido.items.length;
            var estadoP=esTotal
              ? sPatch("/"+pr+"pedidos?codigo_pedido=eq."+encodeURIComponent(codigo), {estado:"devuelto"}, true)
              : Promise.resolve();
            return Promise.all([Promise.all(updates),estadoP]).then(function(){ return {ok:true}; });
          });
      });
  },

  balance: function(esquema) {
    var pr=pfx(esquema);
    var hace7=new Date(Date.now()-7*24*3600*1000).toISOString();
    return Promise.all([
      sGet("/"+pr+"pedidos?creado_en=gte."+hace7, true),
      sGet("/"+pr+"productos?order=id.asc", true)
    ]).then(function(res){
      var pedidos=res[0], prods=res[1];
      var costoPorId={};
      prods.forEach(function(p){ costoPorId[p.id]=Number(p.precio_costo||0); });
      var totalVendido=0,totalCosto=0,ventasPorProd={};
      pedidos.forEach(function(ped){
        if(ped.estado==="devuelto") return;
        totalVendido+=Number(ped.total_final);
        (ped.items||[]).forEach(function(it){
          totalCosto+=(costoPorId[it.id]||0)*it.cantidad;
          if(!ventasPorProd[it.id]) ventasPorProd[it.id]={nombre:it.nombre,unidades:0,ingresos:0};
          ventasPorProd[it.id].unidades+=it.cantidad;
          ventasPorProd[it.id].ingresos+=it.subtotal;
        });
      });
      var masVendidos=Object.values(ventasPorProd).sort(function(a,b){ return b.unidades-a.unidades; }).slice(0,10);
      var idsConVenta={};
      pedidos.forEach(function(ped){ (ped.items||[]).forEach(function(it){ idsConVenta[it.id]=true; }); });
      var sinMovimiento=prods.filter(function(p){ return !idsConVenta[p.id]&&p.stock>0; })
        .map(function(p){ return {id:p.id,nombre:p.nombre,stock:p.stock}; });
      return {
        balance:{total_vendido:totalVendido,total_costo:totalCosto,ganancia_neta:totalVendido-totalCosto,
          pedidos_total:pedidos.length,
          pedidos_aprobados:pedidos.filter(function(p){ return p.estado==="aprobado"; }).length,
          pedidos_pendientes:pedidos.filter(function(p){ return p.estado==="pendiente"; }).length},
        mas_vendidos:masVendidos, sin_movimiento:sinMovimiento
      };
    });
  },

  guardarConfig: function(esquema, cambios) {
    var pr=pfx(esquema);
    return Promise.all(Object.keys(cambios).map(function(clave){
      return sPatch("/"+pr+"config?clave=eq."+encodeURIComponent(clave), {valor:String(cambios[clave])}, true);
    }));
  }
};

/* ============================================================
   MÓDULO DE PRECIOS — funciones para el sistema dinámico
   ============================================================ */
var PRECIOS_API = {

  // Cargar toda la configuración de precios + márgenes
  cargarConfig: function(esquema) {
    var p = pfx(esquema);
    return Promise.all([
      sGet("/"+p+"config_precios?select=clave,valor", true),
      sGet("/"+p+"margenes?order=desde.asc", true)
    ]).then(function(res) {
      var cfg = {};
      (res[0]||[]).forEach(function(r){ cfg[r.clave] = r.valor; });
      return {
        tc_actual:         parseFloat(cfg.tc_actual || 6.97),
        tc_fecha:          cfg.tc_fecha || '',
        redondeo:          cfg.redondeo || 'medio',
        margen_modo:       cfg.margen_modo || 'tabla',
        margen_fijo_pct:   parseFloat(cfg.margen_fijo_pct || 50),
        curva_margen_max:  parseFloat(cfg.curva_margen_max || 200),
        curva_margen_min:  parseFloat(cfg.curva_margen_min || 20),
        curva_costo_ref:   parseFloat(cfg.curva_costo_ref || 5),
        curva_agresividad: parseFloat(cfg.curva_agresividad || 0.45),
        margenes:          res[1] || []
      };
    });
  },

  // Guardar configuración de precios
  guardarConfig: function(esquema, cambios) {
    var p = pfx(esquema);
    return Promise.all(Object.keys(cambios).map(function(clave) {
      return sPatch("/"+p+"config_precios?clave=eq."+encodeURIComponent(clave),
        { valor: String(cambios[clave]) }, true);
    }));
  },

  // Guardar tabla de márgenes completa (borra y recrea)
  guardarMargenes: function(esquema, margenes) {
    var p = pfx(esquema);
    // 1) Borrar todos los rangos actuales
    return fetch(SUPA_URL+"/rest/v1/"+p+"margenes?id=gte.0",
      { method:"DELETE", headers:hdr(true) })
    .then(function() {
      // 2) Insertar los nuevos
      return sPost("/"+p+"margenes", margenes, true);
    });
  },

  // Calcular precio en el navegador (sin llamar a Supabase)
  // Replica la misma lógica que la función SQL
  calcularPrecioLocal: function(costo, cfg, precioMinimo) {
    if (!costo || costo <= 0) return 0;

    var margen = 0;

    if (cfg.margen_modo === 'fijo') {
      margen = cfg.margen_fijo_pct;

    } else if (cfg.margen_modo === 'curva') {
      var max = cfg.curva_margen_max;
      var min = cfg.curva_margen_min;
      var ref = cfg.curva_costo_ref;
      var agr = cfg.curva_agresividad;
      margen = min + (max - min) * Math.pow(ref / costo, agr);
      margen = Math.max(min, Math.min(max, margen));

    } else { // tabla
      var rangos = cfg.margenes || [];
      for (var i = 0; i < rangos.length; i++) {
        var r = rangos[i];
        if (costo >= r.desde && (r.hasta === null || costo <= r.hasta)) {
          margen = parseFloat(r.margen_pct);
          break;
        }
      }
      if (!margen) margen = 20;
    }

    var precioRaw = costo * (1 + margen / 100);
    var unidad    = cfg.redondeo === 'entero' ? 1.0 : 0.5;
    var precioFin = Math.ceil(precioRaw / unidad) * unidad;

    if (precioMinimo && precioFin < precioMinimo) precioFin = precioMinimo;

    return { precio: precioFin, margen: Math.round(margen * 100) / 100 };
  },

  // Calcular costo dinámico con protección de capital
  calcularCostoDinamico: function(precioCompraBs, tcCompra, tcActual) {
    if (!precioCompraBs || !tcCompra || tcCompra <= 0) return precioCompraBs || 0;
    var costoAjustado = precioCompraBs * (tcActual / tcCompra);
    return Math.max(precioCompraBs, costoAjustado); // nunca baja del costo original
  },

  // Recálculo masivo usando la función SQL de Supabase
  // Devuelve la lista de cambios para mostrar vista previa
  recalcularTodos: function(esquema, tcNuevo) {
    return fetch(SUPA_URL+"/rest/v1/rpc/recalcular_precios_dinamicos", {
      method:  "POST",
      headers: hdr(true),
      body:    JSON.stringify({ p_tc_nuevo: tcNuevo })
    }).then(function(r) {
      return r.ok ? r.json() : r.json().then(function(e){ throw new Error(e.message||JSON.stringify(e)); });
    });
  },

  // Vista de resumen de precios (para la tabla del admin)
  vistaPrecios: function(esquema) {
    return sGet("/lib_vista_precios?order=id.asc", true);
  }
};
