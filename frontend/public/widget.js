/**
 * MSX AI Chat Widget
 * Embeddable floating chat widget for the Muscat Stock Exchange AI.
 *
 * Usage:
 *   <script src="https://your-server/widget.js"></script>
 *   <div id="msx-chat"></div>
 *   <script>MSXChat.init({ lang: 'en' })</script>
 */
;(function (window, document) {
  'use strict'

  var DEFAULT_OPTIONS = {
    lang:         'en',
    position:     'right',   // 'left' | 'right'
    primaryColor: '#003d7a',
    accentColor:  '#c8a84b',
    serverUrl:    '',         // leave blank to use same origin
    buttonSize:   60,
    zIndex:       9999,
  }

  var state = {
    open:    false,
    options: {},
    iframe:  null,
    button:  null,
    wrapper: null,
  }

  /* ── Helpers ───────────────────────────────────────────────── */

  function merge(target, src) {
    var out = {}
    for (var k in target) out[k] = target[k]
    for (var k in src)    out[k] = src[k]
    return out
  }

  function px(n) { return n + 'px' }

  function injectStyles(css) {
    var style = document.createElement('style')
    style.textContent = css
    document.head.appendChild(style)
  }

  /* ── Build DOM ─────────────────────────────────────────────── */

  function buildWidget(opts) {
    var side   = opts.position === 'left' ? 'left' : 'right'
    var offset = '20px'

    // Container
    var wrapper        = document.createElement('div')
    wrapper.id         = 'msx-chat-widget'
    wrapper.style.cssText = [
      'position:fixed',
      'bottom:20px',
      side + ':' + offset,
      'z-index:' + opts.zIndex,
      'display:flex',
      'flex-direction:column',
      'align-items:' + (side === 'left' ? 'flex-start' : 'flex-end'),
      'gap:12px',
      'font-family:Inter,system-ui,sans-serif',
    ].join(';')

    // Iframe (chat window)
    var iframe              = document.createElement('iframe')
    iframe.id               = 'msx-chat-iframe'
    iframe.src              = (opts.serverUrl || '') + '/?channel=widget&lang=' + opts.lang
    iframe.allow            = 'microphone'
    iframe.style.cssText    = [
      'width:380px',
      'height:600px',
      'border:none',
      'border-radius:16px',
      'box-shadow:0 20px 60px rgba(0,0,0,0.4)',
      'opacity:0',
      'pointer-events:none',
      'transform:translateY(16px) scale(0.97)',
      'transition:opacity 0.25s ease,transform 0.25s ease',
      'background:#0f172a',
    ].join(';')
    iframe.setAttribute('aria-hidden', 'true')
    iframe.setAttribute('title', 'MSX AI Chat')

    // Toggle button
    var btn             = document.createElement('button')
    btn.id              = 'msx-chat-btn'
    btn.setAttribute('aria-label', 'Open MSX AI Chat')
    btn.style.cssText   = [
      'width:'  + px(opts.buttonSize),
      'height:' + px(opts.buttonSize),
      'border-radius:50%',
      'border:none',
      'background:' + opts.primaryColor,
      'cursor:pointer',
      'box-shadow:0 4px 20px rgba(0,0,0,0.35)',
      'display:flex',
      'align-items:center',
      'justify-content:center',
      'transition:transform 0.2s ease,box-shadow 0.2s ease',
      'flex-shrink:0',
    ].join(';')

    // SVG icons
    var iconChat = '<svg xmlns="http://www.w3.org/2000/svg" width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>'
    var iconClose = '<svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>'

    btn.innerHTML = iconChat

    // Unread badge
    var badge           = document.createElement('div')
    badge.id            = 'msx-chat-badge'
    badge.style.cssText = [
      'position:absolute',
      'top:-4px',
      side === 'left' ? 'right:-4px' : 'left:-4px',
      'width:18px',
      'height:18px',
      'border-radius:50%',
      'background:#ef4444',
      'color:white',
      'font-size:10px',
      'font-weight:700',
      'display:none',
      'align-items:center',
      'justify-content:center',
      'border:2px solid #0f172a',
    ].join(';')

    var btnWrap             = document.createElement('div')
    btnWrap.style.cssText   = 'position:relative'
    btnWrap.appendChild(badge)
    btnWrap.appendChild(btn)

    wrapper.appendChild(iframe)
    wrapper.appendChild(btnWrap)
    document.body.appendChild(wrapper)

    /* ── Interactions ──────────────────────────────────────── */

    btn.addEventListener('mouseenter', function () {
      if (!state.open) {
        btn.style.transform  = 'scale(1.08)'
        btn.style.boxShadow  = '0 6px 24px rgba(0,0,0,0.45)'
      }
    })
    btn.addEventListener('mouseleave', function () {
      btn.style.transform = ''
      btn.style.boxShadow = '0 4px 20px rgba(0,0,0,0.35)'
    })
    btn.addEventListener('click', function () {
      toggle(opts, iframe, btn, badge, iconChat, iconClose)
    })

    // Keyboard: Escape closes
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && state.open) {
        close(opts, iframe, btn, badge, iconChat)
      }
    })

    // Cross-frame messages from the chat
    window.addEventListener('message', function (e) {
      if (!e.data || typeof e.data !== 'object') return
      if (e.data.type === 'MSX_CLOSE')  close(opts, iframe, btn, badge, iconChat)
      if (e.data.type === 'MSX_UNREAD') showBadge(badge, e.data.count)
    })

    state.iframe  = iframe
    state.button  = btn
    state.wrapper = wrapper

    return wrapper
  }

  function toggle(opts, iframe, btn, badge, iconChat, iconClose) {
    if (state.open) {
      close(opts, iframe, btn, badge, iconChat)
    } else {
      open(opts, iframe, btn, badge, iconClose)
    }
  }

  function open(opts, iframe, btn, badge, iconClose) {
    state.open = true
    iframe.style.opacity         = '1'
    iframe.style.pointerEvents   = 'auto'
    iframe.style.transform       = 'translateY(0) scale(1)'
    iframe.setAttribute('aria-hidden', 'false')
    btn.innerHTML                = iconClose
    btn.style.background         = '#1e293b'
    btn.setAttribute('aria-label', 'Close MSX AI Chat')
    hideBadge(badge)
  }

  function close(opts, iframe, btn, badge, iconChat) {
    state.open = false
    iframe.style.opacity         = '0'
    iframe.style.pointerEvents   = 'none'
    iframe.style.transform       = 'translateY(16px) scale(0.97)'
    iframe.setAttribute('aria-hidden', 'true')
    btn.innerHTML                = iconChat
    btn.style.background         = opts.primaryColor
    btn.setAttribute('aria-label', 'Open MSX AI Chat')
  }

  function showBadge(badge, count) {
    badge.style.display    = 'flex'
    badge.textContent      = count > 9 ? '9+' : String(count || '')
  }

  function hideBadge(badge) {
    badge.style.display = 'none'
  }

  /* ── CSS ───────────────────────────────────────────────────── */

  injectStyles([
    '#msx-chat-btn:focus-visible{',
    '  outline:2px solid #60a5fa;',
    '  outline-offset:3px;',
    '}',
    '@media (max-width:440px){',
    '  #msx-chat-iframe{',
    '    width:calc(100vw - 16px) !important;',
    '    height:calc(100dvh - 90px) !important;',
    '    border-radius:12px !important;',
    '  }',
    '  #msx-chat-widget{',
    '    right:8px !important;',
    '    left:8px !important;',
    '    align-items:flex-end !important;',
    '  }',
    '}',
  ].join('\n'))

  /* ── Public API ────────────────────────────────────────────── */

  window.MSXChat = {
    init: function (userOptions) {
      var opts     = merge(DEFAULT_OPTIONS, userOptions || {})
      state.options = opts
      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', function () { buildWidget(opts) })
      } else {
        buildWidget(opts)
      }
    },
    open:  function () { if (state.iframe && state.button) open(state.options,  state.iframe, state.button, document.getElementById('msx-chat-badge'), '<svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>') },
    close: function () { if (state.iframe && state.button) close(state.options, state.iframe, state.button, document.getElementById('msx-chat-badge'), '<svg xmlns="http://www.w3.org/2000/svg" width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>') },
  }

}(window, document))
