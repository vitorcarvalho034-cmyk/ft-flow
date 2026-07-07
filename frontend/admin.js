// Admin UI enhancements: Configurações + purchase admin buttons
(function(){
  // wait until globals from app.js are available
  function ready(fn){
    if(window.js && window.API && document.getElementById('app')) return fn();
    setTimeout(()=>ready(fn),200);
  }

  ready(()=>{
    const sidebar = document.querySelector('.sidebar');
    if(sidebar){
      // create Configurações nav button (admin-only)
      const btn = document.createElement('button');
      btn.className = 'nav admin-only';
      btn.innerText = 'Configurações';
      btn.addEventListener('click', function(){
        try{ trocarTela('configuracoes', this); }catch(e){}
      });
      // insert before Histórico button if present
      const hist = Array.from(sidebar.querySelectorAll('.nav')).find(n=>/Historico/i.test(n.innerText)||/Histórico/i.test(n.innerText));
      if(hist) sidebar.insertBefore(btn, hist);
      else sidebar.appendChild(btn);
    }

    // expose configuracoes function used by trocarTela
    window.configuracoes = async function(){
      const isAdmin = usuario && usuario.role === 'admin';
      if(!isAdmin){
        content.innerHTML = `<div class="panel"><h3>Configurações</h3><p>Somente administradores podem acessar esta área.</p></div>`;
        return;
      }
      content.innerHTML = `
        <div class="panel">
          <h3>Configurações</h3>
          <div class="grid">
            <div>
              <h4>Alterar senha</h4>
              <label>Perfil
                <select id="cfgUserRole">
                  <option value="admin">Admin</option>
                  <option value="funcionario">Operador</option>
                </select>
              </label>
              <label>Nova senha<input id="cfgNewPassword" type="password"></label>
              <button class="primary" id="btnChangePw">Alterar senha</button>
              <div id="cfgMsg" style="margin-top:8px"></div>
            </div>
          </div>
        </div>
      `;

      document.getElementById('btnChangePw').addEventListener('click', async ()=>{
        const role = document.getElementById('cfgUserRole').value;
        const newPassword = document.getElementById('cfgNewPassword').value;
        const msgEl = document.getElementById('cfgMsg');
        msgEl.innerText = '';
        if(!newPassword) return msgEl.innerText = 'Informe a nova senha.';
        try{
          await js(API + '/admin/change-password', {
            method: 'POST',
            headers: {'Content-Type':'application/json'},
            body: JSON.stringify({ userRole: role, newPassword })
          });
          msgEl.innerText = 'Senha alterada com sucesso.';
          document.getElementById('cfgNewPassword').value = '';
        }catch(e){ msgEl.innerText = 'Erro: ' + e.message; }
      });
    };

    // functions to call backend endpoints
    window.aprovarRecebido = async function(id){
      if(!confirm('Confirmar marcação como recebido?')) return;
      try{
        await js(API + `/compras/${id}/approve-received`, { method: 'POST' });
        mostrarSucesso('Compra marcada como recebida');
        if(typeof carregar === 'function') carregar();
      }catch(e){ mostrarErro(e.message); }
    };

    window.excluirCompra = async function(id){
      if(!confirm('Tem certeza que deseja excluir esta compra? Esta ação é irreversível.')) return;
      try{
        await js(API + `/compras/${id}`, { method: 'DELETE' });
        mostrarSucesso('Compra excluída');
        if(typeof carregar === 'function') carregar();
      }catch(e){ mostrarErro(e.message); }
    };

    // inject buttons into purchase cards when they appear
    function attachPurchaseAdminButtons(){
      try{
        const cards = document.querySelectorAll('.pedido-card');
        if(!cards || !cards.length) return;
        cards.forEach(card=>{
          if(card.dataset._adminButtons) return; // already processed
          const title = card.querySelector('.pedido-titulo');
          let id = null;
          if(title){
            const m = title.innerText.match(/#(\d+)/);
            if(m) id = m[1];
          }
          if(!id) return;
          let actions = card.querySelector('.actions');
          if(!actions){
            actions = document.createElement('div'); actions.className = 'actions'; actions.style.marginTop='10px';
            card.appendChild(actions);
          }
          // Approve received button
          const btnA = document.createElement('button');
          btnA.className = 'primary';
          btnA.style.marginRight = '8px';
          btnA.innerText = 'Aprovar recebido';
          btnA.addEventListener('click', ()=>aprovarRecebido(id));
          // Delete button
          const btnD = document.createElement('button');
          btnD.className = 'danger';
          btnD.innerText = 'Excluir compra';
          btnD.addEventListener('click', ()=>excluirCompra(id));

          actions.appendChild(btnA);
          actions.appendChild(btnD);
          card.dataset._adminButtons = '1';
        });
      }catch(e){ console.error('attachPurchaseAdminButtons', e); }
    }

    // observe content area for changes
    const contentEl = document.getElementById('content');
    if(contentEl){
      const obs = new MutationObserver((mut)=>{
        // attach when compras/historico pages render
        attachPurchaseAdminButtons();
      });
      obs.observe(contentEl,{childList:true, subtree:true});
    }

    // also attach on load
    setTimeout(attachPurchaseAdminButtons, 800);
  });
})();
