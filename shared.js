/* Shared by both pages: who you are, undo toasts, the activity feed, comment threads, and the trash bin.
   Usage: const T = TripShared(sb); */
(function(){
  const NAME_KEY = "trip-name", ID_KEY = "trip-device-id", ASKED_KEY = "trip-name-asked";
  const ls = {
    get(k){ try{ return localStorage.getItem(k); }catch(e){ return null; } },
    set(k,v){ try{ localStorage.setItem(k,v); }catch(e){} }
  };
  function el(tag, cls, text){ const e=document.createElement(tag); if(cls) e.className=cls; if(text!=null) e.textContent=text; return e; }
  function ago(ts){
    const s=Math.max(0,(Date.now()-new Date(ts).getTime())/1000);
    if(s<45) return "just now";
    const m=Math.round(s/60); if(m<60) return m+" min ago";
    const h=Math.round(m/60); if(h<24) return h+(h===1?" hr ago":" hrs ago");
    const d=Math.round(h/24); if(d<7) return d+(d===1?" day ago":" days ago");
    return new Date(ts).toLocaleDateString(undefined,{month:"short",day:"numeric"});
  }

  // Offline support: register the service worker (pages, trip data, and viewed map tiles keep working without signal).
  if("serviceWorker" in navigator && location.protocol==="https:"){
    navigator.serviceWorker.register("sw.js").catch(()=>{});
  }

  window.TripShared = function(sb){
    const api = { el, ago };

    // Offline banner
    const off = el("div","offline-bar"); off.setAttribute("role","status");
    off.textContent = "You're offline. Showing your last saved plan; changes will need a connection.";
    document.body.prepend(off);
    const paintOff = ()=>{ off.hidden = navigator.onLine; document.body.classList.toggle("is-offline", !navigator.onLine); };
    paintOff();
    window.addEventListener("online", paintOff); window.addEventListener("offline", paintOff);
    api.onOnline = (fn)=>window.addEventListener("online", fn);

    // ---------- who you are (no accounts: a name you pick + a random id for this browser) ----------
    let id = ls.get(ID_KEY);
    if(!id || id.length<8){
      id = (window.crypto && crypto.randomUUID) ? crypto.randomUUID() : Date.now().toString(36)+Math.random().toString(36).slice(2,12);
      ls.set(ID_KEY,id);
    }
    let name = (ls.get(NAME_KEY)||"").trim().slice(0,40);
    const nameListeners = [];
    api.id = id;
    api.name = () => name || "Someone";
    api.rawName = () => name;
    api.onNameChange = fn => nameListeners.push(fn);

    const whoBtn = document.getElementById("whoBtn");
    function paintWho(){
      if(!whoBtn) return;
      whoBtn.textContent = name ? "👤 "+name : "👤 Set name";
      whoBtn.setAttribute("aria-label", name ? "You are "+name+". Change your name" : "Set your name");
    }
    paintWho();

    const nameDlg = el("dialog","dlg");
    nameDlg.innerHTML =
      '<form method="dialog" class="dlg-body">'+
      '<h2>What should everyone call you?</h2>'+
      '<p>Your name shows next to what you add, vote on, and comment on. No account needed.</p>'+
      '<input name="n" maxlength="40" autocomplete="nickname" placeholder="e.g. Tyler" aria-label="Your name">'+
      '<div class="dlg-btns"><button value="save" class="btn btn-primary">Save</button>'+
      '<button value="skip" class="btn btn-ghost" formnovalidate>Not now</button></div></form>';
    document.body.append(nameDlg);
    const nameInput = nameDlg.querySelector("input");
    let nameResolve = null;
    nameDlg.addEventListener("close", ()=>{
      if(nameDlg.returnValue==="save"){
        const v = nameInput.value.trim().slice(0,40);
        if(v && v!==name){ name=v; ls.set(NAME_KEY,name); paintWho(); nameListeners.forEach(f=>f(name)); }
      }
      ls.set(ASKED_KEY,"1");
      if(nameResolve){ nameResolve(api.name()); nameResolve=null; }
    });
    api.askName = () => new Promise(res=>{
      nameResolve = res; nameInput.value = name; nameDlg.returnValue = "";
      nameDlg.showModal(); setTimeout(()=>nameInput.select(),0);
    });
    if(whoBtn) whoBtn.addEventListener("click", ()=>api.askName());
    api.maybeAskName = () => { if(!name && !ls.get(ASKED_KEY)) api.askName(); };
    // Stamp for writes: who made this change.
    api.by = () => ({ updated_by: name });
    api.byNew = () => ({ created_by: name, updated_by: name });

    // ---------- toast with Undo ----------
    const toastEl = el("div","toast"); toastEl.setAttribute("role","status"); toastEl.hidden = true;
    document.body.append(toastEl);
    let toastTimer = null;
    api.toast = (msg, undo) => {
      clearTimeout(toastTimer);
      toastEl.replaceChildren(el("span","toast-msg",msg));
      if(undo){
        const b = el("button","toast-undo","Undo"); b.type = "button";
        b.onclick = async ()=>{
          b.disabled = true; clearTimeout(toastTimer);
          try{ await undo(); api.toast("Undone."); }
          catch(e){ console.error(e); api.toast("Couldn't undo that."); }
        };
        toastEl.append(b);
      }
      const x = el("button","toast-x","✕"); x.type="button"; x.setAttribute("aria-label","Dismiss");
      x.onclick = ()=>{ clearTimeout(toastTimer); toastEl.hidden=true; };
      toastEl.append(x);
      toastEl.hidden = false;
      toastEl.classList.remove("show"); void toastEl.offsetWidth; toastEl.classList.add("show");
      toastTimer = setTimeout(()=>{ toastEl.hidden = true; }, undo ? 9000 : 3500);
    };
    // Helper: throw on a Supabase error so Undo can report failure.
    api.ok = (res) => { if(res && res.error) throw res.error; return res; };

    // ---------- drawers (activity, trash) ----------
    function drawer(title, note){
      const d = el("dialog","dlg drawer");
      const head = el("div","drawer-head");
      head.append(el("h2","",title));
      const x = el("button","drawer-close","✕"); x.type="button"; x.setAttribute("aria-label","Close "+title.toLowerCase());
      x.onclick = ()=>d.close();
      head.append(x);
      d.append(head);
      if(note) d.append(el("p","drawer-note",note));
      const list = el("ul","drawer-list"); d.append(list);
      d.addEventListener("click", e=>{ if(e.target===d) d.close(); });   // click on backdrop
      document.body.append(d);
      return { d, list };
    }

    api.makeDrawer = drawer;

    // Activity feed
    const act = drawer("Activity");
    let actRows = [];
    function paintAct(){
      act.list.replaceChildren();
      if(!actRows.length){ act.list.append(el("li","drawer-empty","Nothing yet.")); return; }
      for(const a of actRows){
        const li = el("li","act");
        const line = el("div","act-line");
        line.append(el("b","",a.actor||"Someone"), " "+a.verb+" ");
        if(a.subject) line.append(el("b","",a.subject));
        if(a.detail) line.append(" "+a.detail);
        li.append(line, el("div","act-time",ago(a.at)));
        act.list.append(li);
      }
    }
    api.openActivity = async ()=>{
      act.d.showModal();
      act.list.replaceChildren(el("li","drawer-empty","Loading…"));
      const { data, error } = await sb.from("activity").select("*").order("id",{ascending:false}).limit(100);
      if(error){ act.list.replaceChildren(el("li","drawer-empty","Couldn't load activity.")); return; }
      actRows = data; paintAct();
    };
    const actBtn = document.getElementById("activityBtn");
    if(actBtn) actBtn.addEventListener("click", ()=>api.openActivity());
    sb.channel("activity-live")
      .on("postgres_changes",{ event:"INSERT", schema:"public", table:"activity" }, pl=>{
        if(act.d.open){ actRows.unshift(pl.new); paintAct(); }
      }).subscribe();

    // Trash: the page supplies how to load, restore, and purge its own rows.
    const trash = drawer("Trash","Removed things wait here. Restore them, or delete them for good.");
    api.openTrash = async ({ load, restore, purge })=>{
      trash.d.showModal();
      async function paint(){
        trash.list.replaceChildren(el("li","drawer-empty","Loading…"));
        let rows;
        try{ rows = await load(); }catch(e){ trash.list.replaceChildren(el("li","drawer-empty","Couldn't load the trash.")); return; }
        trash.list.replaceChildren();
        if(!rows.length){ trash.list.append(el("li","drawer-empty","The trash is empty.")); return; }
        for(const r of rows){
          const li = el("li","trash-row");
          const info = el("div","trash-info");
          info.append(el("div","trash-name",r.name));
          info.append(el("div","act-time",[r.sub, "Removed "+ago(r.deleted_at)+(r.by?" by "+r.by:"")].filter(Boolean).join(" · ")));
          const btns = el("div","trash-btns");
          const res = el("button","btn btn-primary btn-sm","Restore"); res.type="button";
          res.onclick = async ()=>{ res.disabled=true; try{ await restore(r); api.toast("Restored "+r.name+"."); await paint(); }catch(e){ res.disabled=false; api.toast(e && e.code==="23505" ? r.name+" is already back on the list." : "Couldn't restore that."); } };
          const del = el("button","btn btn-ghost btn-sm danger-text","Delete forever"); del.type="button";
          let armed=false;
          del.onclick = async ()=>{
            if(!armed){ armed=true; del.textContent="Really delete?"; setTimeout(()=>{ armed=false; del.textContent="Delete forever"; },4000); return; }
            del.disabled=true; try{ await purge(r); await paint(); }catch(e){ del.disabled=false; api.toast("Couldn't delete that."); }
          };
          btns.append(res,del);
          li.append(info,btns);
          trash.list.append(li);
        }
      }
      await paint();
    };

    // ---------- comment threads ----------
    const drafts = new Map();
    api.thread = ({ key, comments, target, label, onChange })=>{
      const box = el("div","thread");
      box.setAttribute("role","group"); box.setAttribute("aria-label","Comments on "+label);
      const list = comments.slice().sort((a,b)=>a.created_at<b.created_at?-1:1);
      for(const c of list){
        const row = el("div","cmt");
        const head = el("div","cmt-head");
        head.append(el("b","",c.author_name||"Someone"), el("span","cmt-time",ago(c.created_at)));
        if(c.author_id===id){
          const del = el("button","link danger cmt-del","Delete"); del.type="button";
          del.onclick = async ()=>{
            const { error } = await sb.from("comments").delete().eq("id",c.id);
            if(error) api.toast("Couldn't delete that comment."); else onChange && onChange();
          };
          head.append(del);
        }
        row.append(head, el("div","cmt-body",c.body));
        box.append(row);
      }
      const f = el("div","cmt-new");
      const inp = el("textarea"); inp.rows=1; inp.maxLength=500; inp.placeholder="Add a comment…";
      inp.value = drafts.get(key)||""; inp.dataset.focusKey = "thread:"+key;
      inp.setAttribute("aria-label","Add a comment on "+label);
      inp.addEventListener("input", ()=>drafts.set(key,inp.value));
      const post = el("button","btn btn-primary btn-sm","Post"); post.type="button";
      const send = async ()=>{
        const body = inp.value.trim(); if(!body) return;
        post.disabled = true;
        if(!name && !ls.get(ASKED_KEY)) await api.askName();
        const { error } = await sb.from("comments").insert({ ...target, author_id:id, author_name:name, body });
        post.disabled = false;
        if(error){ api.toast("Couldn't post that comment."); return; }
        drafts.delete(key); inp.value = "";
        onChange && onChange();
      };
      post.onclick = send;
      inp.addEventListener("keydown", e=>{ if(e.key==="Enter" && !e.shiftKey){ e.preventDefault(); send(); } });
      f.append(inp, post);
      box.append(f);
      return box;
    };

    // Keep focus on the same control across a full redraw (elements carry data-focus-key).
    api.preserveFocus = (fn)=>{
      const ae = document.activeElement;
      const key = ae && ae.dataset ? ae.dataset.focusKey : null;
      const sel = key && (ae.selectionStart!=null) ? [ae.selectionStart, ae.selectionEnd] : null;
      fn();
      if(key){
        const n = document.querySelector('[data-focus-key="'+CSS.escape(key)+'"]');
        if(n){ n.focus({preventScroll:true}); if(sel && n.setSelectionRange) try{ n.setSelectionRange(sel[0],sel[1]); }catch(e){} }
      }
    };
    // True while someone is typing in an editor, comment box, or dialog: pages hold off redraws.
    api.busyTyping = ()=>{
      const ae = document.activeElement;
      return !!(ae && ae.closest && ae.closest(".editor, .desc-editor, .thread, dialog") && /^(INPUT|TEXTAREA|SELECT)$/.test(ae.tagName));
    };

    // ---------- context menu (right-click, long-press, or a More button) ----------
    // items: [{ label, fn, danger }] with "-" for a divider.
    const menu = el("div","menu"); menu.setAttribute("role","menu"); menu.hidden = true; document.body.append(menu);
    let menuReturn = null, menuOpenedAt = 0;
    function closeMenu(restore){
      if(menu.hidden) return;
      menu.hidden = true; menu.replaceChildren();
      if(restore && menuReturn && document.contains(menuReturn)) menuReturn.focus();
      menuReturn = null;
    }
    api.closeMenu = closeMenu;
    api.openMenu = ({ title, items, x, y, focusFirst, returnTo })=>{
      closeMenu(false);
      menuReturn = returnTo || null;
      menu.setAttribute("aria-label", "Options for "+title);
      menu.append(el("div","menu-title",title));
      for(const it of items){
        if(it==="-"){ menu.append(el("hr")); continue; }
        const b = el("button", it.danger?"danger":"", it.label); b.type="button"; b.setAttribute("role","menuitem"); b.tabIndex=-1;
        b.onclick = ()=>{ closeMenu(false); it.fn(); };
        menu.append(b);
      }
      menu.hidden = false; menuOpenedAt = performance.now();
      const r = menu.getBoundingClientRect();
      const vw = document.documentElement.clientWidth, vh = document.documentElement.clientHeight;
      menu.style.left = Math.max(8, Math.min(x, vw-r.width-8))+"px";
      menu.style.top = Math.max(8, Math.min(y, vh-r.height-8))+"px";
      if(focusFirst){ const f=menu.querySelector("button"); if(f) f.focus(); }
    };
    // Wire a row: right-click opens at the pointer; the keyboard menu key opens at the row.
    api.contextMenuFor = (row, getMenu, skipSelector)=>{
      row.addEventListener("contextmenu", e=>{
        if(skipSelector && e.target.closest(skipSelector)) return;   // keep the browser menu while typing
        e.preventDefault();
        let x=e.clientX, y=e.clientY, kb=false;
        if(!x && !y){ const r=row.getBoundingClientRect(); x=r.left+16; y=r.top+16; kb=true; }
        api.openMenu({ ...getMenu(), x, y, focusFirst:kb, returnTo: kb ? document.activeElement : null });
      });
    };
    document.addEventListener("pointerdown", e=>{ if(!menu.hidden && !menu.contains(e.target)) closeMenu(false); });
    window.addEventListener("scroll", ()=>{ if(performance.now()-menuOpenedAt>200) closeMenu(false); }, true);
    window.addEventListener("resize", ()=>closeMenu(false));
    menu.addEventListener("keydown", e=>{
      const btns=[...menu.querySelectorAll("button")], i=btns.indexOf(document.activeElement);
      if(e.key==="Escape"||e.key==="Tab"){ e.preventDefault(); closeMenu(true); }
      else if(e.key==="ArrowDown"){ e.preventDefault(); btns[(i+1)%btns.length].focus(); }
      else if(e.key==="ArrowUp"){ e.preventDefault(); btns[(i-1+btns.length)%btns.length].focus(); }
      else if(e.key==="Home"){ e.preventDefault(); btns[0].focus(); }
      else if(e.key==="End"){ e.preventDefault(); btns[btns.length-1].focus(); }
    });

    // ---------- votes helpers ----------
    // votes: [{place_id, voter_id, voter_name, value}]
    api.tally = (votes)=>{
      const m = new Map();
      for(const v of votes){
        let t = m.get(v.place_id);
        if(!t){ t = { up:0, down:0, upNames:[], downNames:[], mine:0, legacy:false }; m.set(v.place_id,t); }
        if(v.value>0){ t.up++; t.upNames.push(v.voter_name||"Someone"); } else { t.down++; t.downNames.push(v.voter_name||"Someone"); }
        if(v.voter_id===id) t.mine = v.value;
        if(v.voter_id==="legacy") t.legacy = true;
      }
      return (pid)=> m.get(pid) || { up:0, down:0, upNames:[], downNames:[], mine:0, legacy:false };
    };
    api.vote = async (placeId, value)=>{
      if(value===0) return sb.from("votes").delete().eq("place_id",placeId).eq("voter_id",id);
      return sb.from("votes").upsert({ place_id:placeId, voter_id:id, voter_name:name, value, updated_at:new Date().toISOString() }, { onConflict:"place_id,voter_id" });
    };
    // Keep your name current on your votes if you rename yourself.
    api.onNameChange(async n=>{ await sb.from("votes").update({ voter_name:n }).eq("voter_id",id); });

    return api;
  };
})();
