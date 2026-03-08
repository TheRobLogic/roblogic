/* ============================================
   THE BANCROFT BAR — main.js
   ============================================ */

(function () {
  'use strict';

  // ---- Mobile Nav Toggle ----
  var toggle = document.querySelector('.nav__toggle');
  var links = document.querySelector('.nav__links');

  if (toggle && links) {
    toggle.addEventListener('click', function () {
      var isOpen = links.classList.toggle('nav__links--open');
      toggle.classList.toggle('nav__toggle--open', isOpen);
      toggle.setAttribute('aria-expanded', isOpen);
    });

    // Close nav when a link is clicked
    links.querySelectorAll('.nav__link').forEach(function (link) {
      link.addEventListener('click', function () {
        links.classList.remove('nav__links--open');
        toggle.classList.remove('nav__toggle--open');
        toggle.setAttribute('aria-expanded', 'false');
      });
    });

    // Close nav on scroll
    var lastScrollY = window.scrollY;
    window.addEventListener('scroll', function () {
      if (links.classList.contains('nav__links--open') && Math.abs(window.scrollY - lastScrollY) > 20) {
        links.classList.remove('nav__links--open');
        toggle.classList.remove('nav__toggle--open');
        toggle.setAttribute('aria-expanded', 'false');
      }
      lastScrollY = window.scrollY;
    }, { passive: true });
  }

  // ---- Active Nav Link ----
  var path = window.location.pathname;
  var page = path.split('/').filter(Boolean).pop() || '';
  document.querySelectorAll('.nav__link').forEach(function (link) {
    var href = link.getAttribute('href');
    var isHome = (href === '.' || href === './') && (page === 'bancroft' || page === '' || path.endsWith('/bancroft/'));
    var isMatch = href === page;
    if (isHome || isMatch) {
      link.classList.add('nav__link--active');
    }
  });

  // ---- Booking Form Handler ----
  var form = document.getElementById('booking-form');
  var successMsg = document.getElementById('form-success');
  var errorMsg = document.getElementById('form-error');

  // Check URL params (for server-side redirect flow)
  var params = new URLSearchParams(window.location.search);
  if (params.get('success') === '1' && form && successMsg) {
    form.setAttribute('hidden', '');
    successMsg.removeAttribute('hidden');
  }
  if (params.get('error') === '1' && errorMsg) {
    errorMsg.removeAttribute('hidden');
  }

  // Client-side form submit (test mode — shows success without sending)
  if (form) {
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      if (form && successMsg) {
        form.setAttribute('hidden', '');
        successMsg.removeAttribute('hidden');
        window.scrollTo({ top: 0, behavior: 'smooth' });
      }
    });
  }

  // ---- Scroll Reveal ----
  var reveals = document.querySelectorAll('.reveal');
  if (reveals.length > 0 && 'IntersectionObserver' in window) {
    var observer = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          entry.target.classList.add('reveal--visible');
          observer.unobserve(entry.target);
        }
      });
    }, { threshold: 0.15 });

    reveals.forEach(function (el) { observer.observe(el); });
  } else {
    // Fallback: just show everything
    reveals.forEach(function (el) { el.classList.add('reveal--visible'); });
  }

})();
