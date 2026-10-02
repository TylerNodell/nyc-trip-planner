/* Map helpers shared by both pages (Leaflet + free OpenStreetMap tiles). */
(function(){
  const COLORS = { attraction:"#0039A6", restaurant:"#EE352E", location:"#00933C", shopping:"#FCCC0A", other:"#808183" };
  const LETTER = { attraction:"A", restaurant:"R", location:"L", shopping:"S", other:"O" };

  function tiles(map){
    // Standard OpenStreetMap tiles (free with attribution). Dark mode dims them with a CSS filter.
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
    }).addTo(map);
  }
  function baseMap(el){
    const touch = window.matchMedia("(pointer: coarse)").matches;
    // On phones, one-finger drags should scroll the page, so map dragging is off (zoom buttons still work).
    return L.map(el, { scrollWheelZoom:false, dragging:!touch, tap:!touch, zoomSnap:0.5 });
  }
  function pin(html, cls){ return L.divIcon({ className:"pin-wrap", html:'<span class="pin '+(cls||"")+'">'+html+'</span>', iconSize:[28,28], iconAnchor:[14,14], popupAnchor:[0,-14] }); }
  function esc(s){ return String(s==null?"":s).replace(/[&<>"']/g, c=>({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;" }[c])); }

  // Google encoded polyline -> [[lat,lng],...]
  function decode(str){
    let i=0, lat=0, lng=0; const out=[];
    while(i<str.length){
      for(const which of [0,1]){
        let b, shift=0, result=0;
        do{ b=str.charCodeAt(i++)-63; result|=(b&0x1f)<<shift; shift+=5; }while(b>=0x20);
        const d=(result&1) ? ~(result>>1) : (result>>1);
        if(which===0) lat+=d; else lng+=d;
      }
      out.push([lat/1e5, lng/1e5]);
    }
    return out;
  }

  // One day's plan: home + numbered stops in order, with route lines (exact Google routes when we have them).
  function dayMap(el, { trip, home, savedView, onView }){
    const map = baseMap(el); tiles(map);
    const bounds = [];
    let n = 0;
    for(const p of trip.pts){
      if(p.home){ if(!bounds.some(b=>b===p.ll)){ L.marker(p.ll, { icon:pin("🏠","home"), title:"Home", keyboard:false }).addTo(map).bindPopup("<b>Home</b>"+(home&&home.neighborhood?"<br>"+esc(home.neighborhood):"")); bounds.push(p.ll); } continue; }
      n++;
      L.marker(p.ll, { icon:pin(String(n), "c-"+(p.cat||"other")), title:n+". "+p.name }).addTo(map).bindPopup("<b>"+n+". "+esc(p.name)+"</b>");
      bounds.push(p.ll);
    }
    for(const l of trip.legs){
      if(l.poly){
        L.polyline(decode(l.poly), { color: l.mode==="walk" ? "#5B6166" : "#0039A6", weight:4, opacity:.8, dashArray: l.mode==="walk" ? "2 6" : null }).addTo(map);
      }else{
        L.polyline([l.from.ll, l.to.ll], { color:"#fff", weight:6, opacity:.85 }).addTo(map);   // halo so the line reads on busy streets
        L.polyline([l.from.ll, l.to.ll], { color: l.fromHome||l.toHome ? "#5B6166" : "#000", weight:3, opacity:.9, dashArray:"6 7" }).addTo(map);
      }
    }
    if(savedView) map.setView(savedView.center, savedView.zoom);
    else if(bounds.length===1) map.setView(bounds[0], 15);
    else map.fitBounds(bounds, { padding:[28,28] });
    let userMoved = false;
    map.on("movestart zoomstart", e=>{ if(e && e.originalEvent) userMoved = true; });
    map.on("zoomend dragend", ()=>{ userMoved = true; });
    map.on("moveend", ()=>{ if(userMoved && onView) onView({ center:map.getCenter(), zoom:map.getZoom() }); });
    return map;
  }

  // Every place on the list, colored by category, plus home.
  function placesMap(el, { places, home, onOpen }){
    const map = baseMap(el); tiles(map);
    const bounds = [];
    if(home && typeof home.lat==="number"){
      L.marker([home.lat, home.lng], { icon:pin("🏠","home"), title:"Home" }).addTo(map).bindPopup("<b>Home</b>");
    }
    for(const p of places){
      if(typeof p.lat!=="number" || typeof p.lng!=="number") continue;
      const c = COLORS[p.category] ? p.category : "other";
      const m = L.marker([p.lat, p.lng], { icon:pin(LETTER[c], "c-"+c), title:p.name }).addTo(map);
      m.bindPopup("<b>"+esc(p.name)+"</b>"+(p.type?"<br>"+esc(p.type):"")+(p.neighborhood?"<br><span style='opacity:.7'>"+esc(p.neighborhood)+"</span>":"")+
        (p.maps_url?'<br><a href="'+esc(p.maps_url)+'" target="_blank" rel="noopener">Open in Google Maps</a>':""));
      if(onOpen) m.on("popupopen", ()=>onOpen(p));
      bounds.push([p.lat, p.lng]);
    }
    if(bounds.length) map.fitBounds(bounds, { padding:[30,30] }); else map.setView([40.7359,-73.9911], 12);
    return map;
  }

  window.TripMaps = { dayMap, placesMap, decode, COLORS };
})();
