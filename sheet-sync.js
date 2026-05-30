// ── sheet-sync.js ──────────────────────────────────────────────────────────
// Auto-save + realtime para fichas de personagem.
//
// API:
//   SheetSync.init(charId)
//   SheetSync.save(entry, opts)        // entry = { sheet_data, name, img_url?, space_id? }
//   SheetSync.snapshot()               // rotaciona v1/v2
//   SheetSync.enableSnapshots(ms?)     // default 5min
//   SheetSync.subscribe(onRemote)      // realtime UPDATE -> callback(row)
//   SheetSync.unsubscribe()
//   SheetSync.flag('applyingRemote', true)  // helper p/ pausar autosave durante re-render
//
// Requer (para realtime): <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>
// ───────────────────────────────────────────────────────────────────────────
(function(global) {
  'use strict';

  var SB_URL = 'https://mxyqqfsyybluavwlrhsa.supabase.co';
  var SB_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im14eXFxZnN5eWJsdWF2d2xyaHNhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzgwOTM4MzEsImV4cCI6MjA5MzY2OTgzMX0.b0Ij7UGzbMLpqZjLYxoPEu2kGwEW52U_2NSDtpMGUPM';

  function sbFetch(path, method, body) {
    return fetch(SB_URL + path, {
      method: method || 'GET',
      headers: {
        'apikey': SB_KEY,
        'Authorization': 'Bearer ' + SB_KEY,
        'Content-Type': 'application/json'
      },
      body: body ? JSON.stringify(body) : undefined
    }).then(function(r) {
      if (r.status === 204 || r.headers.get('content-length') === '0') return {};
      return r.json().catch(function() { return {}; });
    });
  }

  var SheetSync = {
    SB_URL: SB_URL,
    SB_KEY: SB_KEY,
    sbFetch: sbFetch,

    charId: null,

    _debounceMs: 800,
    _debounceTimer: null,
    _pendingEntry: null,
    _lastSentHash: '',
    _lastSentAt: 0,
    _existsCache: null,

    _supabaseClient: null,
    _channel: null,
    _onRemote: null,
    _flags: {},

    _snapshotTimer: null,
    _hasChangesSinceSnapshot: false,

    // Estado por-char p/ múltiplas fichas (mestre-view):
    //   _byChar[charId] = { hash, sentAt, channel, onRemote }
    _byChar: {},
    _sharedClient: null,

    init: function(charId) {
      this.charId = charId;
      return this;
    },

    flag: function(name, value) {
      if (value === undefined) return !!this._flags[name];
      this._flags[name] = !!value;
      return this;
    },

    // entry = { sheet_data, name?, img_url?, space_id? }
    // opts  = { immediate: bool }
    save: function(entry, opts) {
      var self = this;
      opts = opts || {};
      if (!this.charId || this.charId === 'default') return Promise.resolve();
      if (this._flags.applyingRemote) return Promise.resolve();

      this._pendingEntry = entry;

      if (this._debounceTimer) {
        clearTimeout(this._debounceTimer);
        this._debounceTimer = null;
      }

      if (opts.immediate) {
        return this._doSave();
      }

      return new Promise(function(resolve) {
        self._debounceTimer = setTimeout(function() {
          self._debounceTimer = null;
          self._doSave().then(resolve, resolve);
        }, self._debounceMs);
      });
    },

    flush: function() {
      if (this._debounceTimer) {
        clearTimeout(this._debounceTimer);
        this._debounceTimer = null;
        return this._doSave();
      }
      return Promise.resolve();
    },

    _doSave: function() {
      var self = this;
      var entry = this._pendingEntry;
      if (!entry) return Promise.resolve();

      var hash = JSON.stringify(entry);
      if (hash === this._lastSentHash) return Promise.resolve();
      this._lastSentHash = hash;
      this._lastSentAt = Date.now();

      var doPatchOrPost = function(exists) {
        var payload = Object.assign({ char_id: self.charId }, entry);
        if (exists) {
          return sbFetch('/rest/v1/personagens?char_id=eq.' + self.charId, 'PATCH', payload);
        } else {
          return sbFetch('/rest/v1/personagens', 'POST', payload);
        }
      };

      // Cache do "existe ou não" para evitar GET extra a cada save
      var existsPromise;
      if (this._existsCache !== null) {
        existsPromise = Promise.resolve(this._existsCache);
      } else {
        existsPromise = sbFetch('/rest/v1/personagens?char_id=eq.' + this.charId + '&select=id', 'GET')
          .then(function(rows) {
            var ex = !!(rows && rows.length);
            self._existsCache = ex;
            return ex;
          });
      }

      return existsPromise
        .then(doPatchOrPost)
        .then(function(res) {
          self._existsCache = true;
          self._hasChangesSinceSnapshot = true;
          return res;
        })
        .catch(function(err) {
          // Permite retry no próximo save
          self._lastSentHash = '';
          throw err;
        });
    },

    // Rotaciona snapshots: v2 = v1 atual, v1 = sheet_data atual
    snapshot: function() {
      var self = this;
      if (!this.charId || this.charId === 'default') return Promise.resolve();
      return sbFetch('/rest/v1/personagens?char_id=eq.' + this.charId + '&select=sheet_data,sheet_data_v1', 'GET')
        .then(function(rows) {
          if (!rows || !rows.length || !rows[0].sheet_data) return;
          var cur = rows[0];
          var patch = {
            sheet_data_v1: cur.sheet_data,
            sheet_data_v2: cur.sheet_data_v1 || null
          };
          self._lastSentAt = Date.now();
          return sbFetch('/rest/v1/personagens?char_id=eq.' + self.charId, 'PATCH', patch);
        });
    },

    enableSnapshots: function(intervalMs) {
      var self = this;
      intervalMs = intervalMs || (5 * 60 * 1000);
      if (this._snapshotTimer) clearInterval(this._snapshotTimer);
      this._snapshotTimer = setInterval(function() {
        if (self._hasChangesSinceSnapshot) {
          self.snapshot().then(function() {
            self._hasChangesSinceSnapshot = false;
          }, function() { /* silencioso */ });
        }
      }, intervalMs);
    },

    subscribe: function(onUpdate) {
      var self = this;
      if (!this.charId || this.charId === 'default') return this;
      if (!global.supabase || !global.supabase.createClient) {
        console.warn('[SheetSync] supabase-js não carregado — realtime desabilitado');
        return this;
      }
      this._onRemote = onUpdate;
      if (!this._supabaseClient) {
        this._supabaseClient = global.supabase.createClient(SB_URL, SB_KEY);
      }
      if (this._channel) this.unsubscribe();
      this._channel = this._supabaseClient.channel('sheet:' + this.charId)
        .on('postgres_changes', {
          event: 'UPDATE',
          schema: 'public',
          table: 'personagens',
          filter: 'char_id=eq.' + this.charId
        }, function(payload) {
          if (!payload || !payload.new) return;
          // Ignora eventos gerados pelo próprio cliente:
          //   1) hash do payload bate com o último que enviamos
          //   2) ou veio dentro de 1500ms do nosso último envio (latência típica)
          var n = payload.new;
          var minorHash = JSON.stringify({
            sheet_data: n.sheet_data,
            name: n.name,
            img_url: n.img_url,
            space_id: n.space_id
          });
          if (minorHash === self._lastSentHash) return;
          if (Date.now() - self._lastSentAt < 1500) return;
          if (self._onRemote) self._onRemote(n);
        })
        .subscribe();
      return this;
    },

    unsubscribe: function() {
      if (this._channel && this._supabaseClient) {
        try { this._supabaseClient.removeChannel(this._channel); } catch (e) {}
        this._channel = null;
      }
      return this;
    },

    // ─── Modo multi-personagem (mestre-view) ────────────────────────
    // Não compartilha estado com init/save/subscribe. Salva e escuta
    // pra um char_id arbitrário sem precisar mudar o `this.charId`.

    _getClient: function() {
      if (!global.supabase || !global.supabase.createClient) return null;
      if (!this._sharedClient) {
        this._sharedClient = global.supabase.createClient(SB_URL, SB_KEY);
      }
      return this._sharedClient;
    },

    _state: function(charId) {
      if (!this._byChar[charId]) this._byChar[charId] = { hash: '', sentAt: 0, channel: null, onRemote: null };
      return this._byChar[charId];
    },

    // entry = { sheet_data, name?, img_url?, space_id? }
    // Sempre imediato. Saves do mesmo charId são SERIALIZADOS via cadeia
    // de promises pra garantir que a ordem de execução no Postgres bate
    // com a ordem de cliques (sem race condition).
    saveFor: function(charId, entry) {
      if (!charId || charId === 'default') return Promise.resolve();
      var st = this._state(charId);
      var hash = JSON.stringify(entry);
      if (hash === st.hash) return Promise.resolve();
      st.hash = hash;
      var payload = Object.assign({ char_id: charId }, entry);
      var prev = st.inflight || Promise.resolve();
      st.inflight = prev.then(function() {
        st.sentAt = Date.now();
        return sbFetch('/rest/v1/personagens?char_id=eq.' + charId, 'PATCH', payload);
      }).catch(function(err) { st.hash = ''; throw err; });
      return st.inflight;
    },

    subscribeFor: function(charId, onUpdate) {
      var self = this;
      if (!charId || charId === 'default') return null;
      var client = this._getClient();
      if (!client) { console.warn('[SheetSync] supabase-js não carregado — realtime desabilitado'); return null; }
      var st = this._state(charId);
      st.onRemote = onUpdate;
      if (st.channel) this.unsubscribeFor(charId);
      st.channel = client.channel('sheet:' + charId)
        .on('postgres_changes', {
          event: 'UPDATE',
          schema: 'public',
          table: 'personagens',
          filter: 'char_id=eq.' + charId
        }, function(payload) {
          if (!payload || !payload.new) return;
          var n = payload.new;
          var minorHash = JSON.stringify({
            sheet_data: n.sheet_data,
            name: n.name,
            img_url: n.img_url,
            space_id: n.space_id
          });
          if (minorHash === st.hash) return;
          if (Date.now() - st.sentAt < 1500) return;
          if (st.onRemote) st.onRemote(n);
        })
        .subscribe();
      return st.channel;
    },

    unsubscribeFor: function(charId) {
      var st = this._byChar[charId];
      if (!st || !st.channel) return;
      if (this._sharedClient) {
        try { this._sharedClient.removeChannel(st.channel); } catch (e) {}
      }
      st.channel = null;
    }
  };

  global.SheetSync = SheetSync;
})(window);
