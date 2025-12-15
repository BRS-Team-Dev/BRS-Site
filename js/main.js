/* ============================================
   BUILT RIGHT STUDIO - MAIN JAVASCRIPT
   Premium Minimal | Luxury Agency Aesthetic
   ============================================ */

/**
 * Table of Contents
 * -----------------
 * 1. DOM Content Loaded Initialization
 * 2. Mobile Navigation
 * 3. Sticky Header
 * 4. Announcement Bar
 * 5. Scroll Reveal Animations
 * 6. Accordion Component
 * 7. Tabs Component
 * 8. Floating CTA
 * 9. Smooth Scroll
 * 10. Form Validation
 * 11. Before/After Slider
 * 12. Counter Animation
 * 13. Utility Functions
 * 14. Page-Specific Initializations
 */

'use strict';

/* ============================================
   1. DOM CONTENT LOADED INITIALIZATION
   ============================================ */

document.addEventListener('DOMContentLoaded', function() {
  // Initialize all components
  initMobileNav();
  initStickyHeader();
  initAnnouncementBar();
  initScrollReveal();
  initAccordions();
  initTabs();
  initFloatingCTA();
  initSmoothScroll();
  initForms();
  initComparisonSliders();
  initCounterAnimations();
  
  // Add loaded class to body for initial animations
  document.body.classList.add('loaded');
  
  console.log('Built Right Studio - All systems initialized');
});

/* ============================================
   2. MOBILE NAVIGATION
   ============================================ */

function initMobileNav() {
  const mobileToggle = document.querySelector('.mobile-toggle');
  const navMobile = document.querySelector('.nav-mobile');
  const navLinks = document.querySelectorAll('.nav-mobile .nav-link');
  const body = document.body;
  
  if (!mobileToggle || !navMobile) return;
  
  // Toggle mobile menu
  mobileToggle.addEventListener('click', function() {
    this.classList.toggle('active');
    navMobile.classList.toggle('active');
    body.classList.toggle('menu-open');
    
    // Toggle aria-expanded for accessibility
    const isExpanded = this.classList.contains('active');
    this.setAttribute('aria-expanded', isExpanded);
    
    // Prevent body scroll when menu is open
    if (isExpanded) {
      body.style.overflow = 'hidden';
    } else {
      body.style.overflow = '';
    }
  });
  
  // Close menu when clicking nav links
  navLinks.forEach(link => {
    link.addEventListener('click', function() {
      mobileToggle.classList.remove('active');
      navMobile.classList.remove('active');
      body.classList.remove('menu-open');
      body.style.overflow = '';
      mobileToggle.setAttribute('aria-expanded', 'false');
    });
  });
  
  // Close menu on escape key
  document.addEventListener('keydown', function(e) {
    if (e.key === 'Escape' && navMobile.classList.contains('active')) {
      mobileToggle.classList.remove('active');
      navMobile.classList.remove('active');
      body.classList.remove('menu-open');
      body.style.overflow = '';
      mobileToggle.setAttribute('aria-expanded', 'false');
    }
  });
  
  // Close menu when clicking outside
  navMobile.addEventListener('click', function(e) {
    if (e.target === navMobile) {
      mobileToggle.classList.remove('active');
      navMobile.classList.remove('active');
      body.classList.remove('menu-open');
      body.style.overflow = '';
      mobileToggle.setAttribute('aria-expanded', 'false');
    }
  });
}

/* ============================================
   3. STICKY HEADER
   ============================================ */

function initStickyHeader() {
  const header = document.querySelector('.header');
  if (!header) return;
  
  const scrollThreshold = 50;
  let lastScrollY = window.scrollY;
  let ticking = false;
  
  function updateHeader() {
    const currentScrollY = window.scrollY;
    
    // Add/remove scrolled class based on scroll position
    if (currentScrollY > scrollThreshold) {
      header.classList.add('scrolled');
    } else {
      header.classList.remove('scrolled');
    }
    
    // Optional: Hide header on scroll down, show on scroll up
    // Uncomment the following if you want this behavior:
    /*
    if (currentScrollY > lastScrollY && currentScrollY > 200) {
      header.classList.add('header-hidden');
    } else {
      header.classList.remove('header-hidden');
    }
    */
    
    lastScrollY = currentScrollY;
    ticking = false;
  }
  
  window.addEventListener('scroll', function() {
    if (!ticking) {
      requestAnimationFrame(updateHeader);
      ticking = true;
    }
  }, { passive: true });
  
  // Initial check
  updateHeader();
}

/* ============================================
   4. ANNOUNCEMENT BAR
   ============================================ */

function initAnnouncementBar() {
  const announcementBar = document.querySelector('.announcement-bar');
  const closeBtn = document.querySelector('.announcement-close');
  const header = document.querySelector('.header');
  const body = document.body;
  
  if (!announcementBar) return;
  
  // Check if announcement was previously dismissed
  const isDismissed = sessionStorage.getItem('announcementDismissed');
  
  if (isDismissed) {
    announcementBar.remove();
    body.classList.remove('has-announcement');
    if (header) header.classList.remove('has-announcement');
    return;
  }
  
  // Add class to body and header
  body.classList.add('has-announcement');
  if (header) header.classList.add('has-announcement');
  
  // Close button functionality
  if (closeBtn) {
    closeBtn.addEventListener('click', function() {
      announcementBar.style.transform = 'translateY(-100%)';
      announcementBar.style.opacity = '0';
      
      setTimeout(() => {
        announcementBar.remove();
        body.classList.remove('has-announcement');
        if (header) header.classList.remove('has-announcement');
      }, 300);
      
      // Remember dismissal for this session
      sessionStorage.setItem('announcementDismissed', 'true');
    });
  }
}

/* ============================================
   5. SCROLL REVEAL ANIMATIONS
   ============================================ */

function initScrollReveal() {
  const revealElements = document.querySelectorAll('.reveal, .reveal-left, .reveal-right, .reveal-scale');
  
  if (revealElements.length === 0) return;
  
  // Check if user prefers reduced motion
  const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  
  if (prefersReducedMotion) {
    revealElements.forEach(el => el.classList.add('revealed'));
    return;
  }
  
  const observerOptions = {
    root: null,
    rootMargin: '0px 0px -10% 0px',
    threshold: 0.1
  };
  
  const revealObserver = new IntersectionObserver((entries, observer) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        // Add staggered delay for children if parent has data-stagger
        const parent = entry.target.closest('[data-stagger]');
        if (parent) {
          const children = parent.querySelectorAll('.reveal, .reveal-left, .reveal-right, .reveal-scale');
          const index = Array.from(children).indexOf(entry.target);
          entry.target.style.transitionDelay = `${index * 100}ms`;
        }
        
        entry.target.classList.add('revealed');
        observer.unobserve(entry.target);
      }
    });
  }, observerOptions);
  
  revealElements.forEach(el => {
    revealObserver.observe(el);
  });
}

/* ============================================
   6. ACCORDION COMPONENT
   ============================================ */

function initAccordions() {
  const accordions = document.querySelectorAll('.accordion');
  
  accordions.forEach(accordion => {
    const headers = accordion.querySelectorAll('.accordion-header');
    
    headers.forEach(header => {
      header.addEventListener('click', function() {
        const isActive = this.classList.contains('active');
        const content = this.nextElementSibling;
        const contentInner = content.querySelector('.accordion-content-inner');
        
        // Close all other accordion items in the same accordion (optional - for single open)
        const allHeaders = accordion.querySelectorAll('.accordion-header');
        const allContents = accordion.querySelectorAll('.accordion-content');
        
        // Check if accordion should allow multiple open items
        const allowMultiple = accordion.hasAttribute('data-allow-multiple');
        
        if (!allowMultiple) {
          allHeaders.forEach(h => {
            if (h !== this) {
              h.classList.remove('active');
              h.setAttribute('aria-expanded', 'false');
            }
          });
          
          allContents.forEach(c => {
            if (c !== content) {
              c.style.maxHeight = null;
            }
          });
        }
        
        // Toggle current item
        this.classList.toggle('active');
        this.setAttribute('aria-expanded', !isActive);
        
        if (!isActive) {
          content.style.maxHeight = contentInner.offsetHeight + 'px';
        } else {
          content.style.maxHeight = null;
        }
      });
      
      // Keyboard accessibility
      header.addEventListener('keydown', function(e) {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          this.click();
        }
      });
    });
  });
}

/* ============================================
   7. TABS COMPONENT
   ============================================ */

function initTabs() {
  const tabContainers = document.querySelectorAll('[data-tabs]');
  
  tabContainers.forEach(container => {
    const tabs = container.querySelectorAll('.tab');
    const tabContents = container.querySelectorAll('.tab-content');
    
    tabs.forEach((tab, index) => {
      tab.addEventListener('click', function() {
        // Remove active class from all tabs and contents
        tabs.forEach(t => {
          t.classList.remove('active');
          t.setAttribute('aria-selected', 'false');
        });
        tabContents.forEach(c => c.classList.remove('active'));
        
        // Add active class to clicked tab and corresponding content
        this.classList.add('active');
        this.setAttribute('aria-selected', 'true');
        
        const targetId = this.getAttribute('data-tab');
        const targetContent = container.querySelector(`#${targetId}`);
        
        if (targetContent) {
          targetContent.classList.add('active');
        } else if (tabContents[index]) {
          tabContents[index].classList.add('active');
        }
      });
      
      // Keyboard navigation
      tab.addEventListener('keydown', function(e) {
        let targetTab = null;
        
        if (e.key === 'ArrowRight') {
          targetTab = this.nextElementSibling || tabs[0];
        } else if (e.key === 'ArrowLeft') {
          targetTab = this.previousElementSibling || tabs[tabs.length - 1];
        } else if (e.key === 'Home') {
          targetTab = tabs[0];
        } else if (e.key === 'End') {
          targetTab = tabs[tabs.length - 1];
        }
        
        if (targetTab) {
          e.preventDefault();
          targetTab.focus();
          targetTab.click();
        }
      });
    });
  });
}

/* ============================================
   8. FLOATING CTA
   ============================================ */

function initFloatingCTA() {
  const floatingCTA = document.querySelector('.floating-cta');
  if (!floatingCTA) return;
  
  const showThreshold = 500; // Show after scrolling 500px
  let ticking = false;
  
  function updateFloatingCTA() {
    if (window.scrollY > showThreshold) {
      floatingCTA.classList.add('visible');
    } else {
      floatingCTA.classList.remove('visible');
    }
    ticking = false;
  }
  
  window.addEventListener('scroll', function() {
    if (!ticking) {
      requestAnimationFrame(updateFloatingCTA);
      ticking = true;
    }
  }, { passive: true });
  
  // Initial check
  updateFloatingCTA();
}

/* ============================================
   9. SMOOTH SCROLL
   ============================================ */

function initSmoothScroll() {
  const smoothScrollLinks = document.querySelectorAll('a[href^="#"]:not([href="#"])');
  
  smoothScrollLinks.forEach(link => {
    link.addEventListener('click', function(e) {
      const targetId = this.getAttribute('href');
      const targetElement = document.querySelector(targetId);
      
      if (targetElement) {
        e.preventDefault();
        
        // Calculate offset for fixed header
        const header = document.querySelector('.header');
        const headerHeight = header ? header.offsetHeight : 0;
        const announcementBar = document.querySelector('.announcement-bar');
        const announcementHeight = announcementBar ? announcementBar.offsetHeight : 0;
        const totalOffset = headerHeight + announcementHeight + 20;
        
        const targetPosition = targetElement.getBoundingClientRect().top + window.pageYOffset - totalOffset;
        
        window.scrollTo({
          top: targetPosition,
          behavior: 'smooth'
        });
        
        // Update URL without jumping
        history.pushState(null, null, targetId);
      }
    });
  });
}

/* ============================================
   10. FORM VALIDATION
   ============================================ */

function initForms() {
  const forms = document.querySelectorAll('form[data-validate]');
  
  forms.forEach(form => {
    const inputs = form.querySelectorAll('input, textarea, select');
    const submitBtn = form.querySelector('[type="submit"]');
    
    // Real-time validation on blur
    inputs.forEach(input => {
      input.addEventListener('blur', function() {
        validateField(this);
      });
      
      // Clear error on input
      input.addEventListener('input', function() {
        clearFieldError(this);
      });
    });
    
    // Form submission
    form.addEventListener('submit', function(e) {
      e.preventDefault();
      
      let isValid = true;
      
      inputs.forEach(input => {
        if (!validateField(input)) {
          isValid = false;
        }
      });
      
      if (isValid) {
        // Show loading state
        if (submitBtn) {
          submitBtn.classList.add('loading');
          submitBtn.disabled = true;
        }
        
        // Get form data
        const formData = new FormData(form);
        const formObject = Object.fromEntries(formData.entries());
        
        // Simulate form submission (replace with actual submission logic)
        console.log('Form submitted:', formObject);
        
        // Simulate async submission
        setTimeout(() => {
          if (submitBtn) {
            submitBtn.classList.remove('loading');
            submitBtn.disabled = false;
          }
          
          // Show success message
          showFormSuccess(form);
          
          // Reset form
          form.reset();
        }, 1500);
      }
    });
  });
}

function validateField(field) {
  const value = field.value.trim();
  const type = field.type;
  const required = field.hasAttribute('required');
  let isValid = true;
  let errorMessage = '';
  
  // Clear previous errors
  clearFieldError(field);
  
  // Required check
  if (required && !value) {
    isValid = false;
    errorMessage = 'This field is required';
  }
  
  // Email validation
  else if (type === 'email' && value) {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(value)) {
      isValid = false;
      errorMessage = 'Please enter a valid email address';
    }
  }
  
  // Phone validation
  else if (type === 'tel' && value) {
    const phoneRegex = /^[\d\s\-\+\(\)]{10,}$/;
    if (!phoneRegex.test(value)) {
      isValid = false;
      errorMessage = 'Please enter a valid phone number';
    }
  }
  
  // URL validation
  else if (type === 'url' && value) {
    try {
      new URL(value);
    } catch {
      isValid = false;
      errorMessage = 'Please enter a valid URL';
    }
  }
  
  // Min length check
  else if (field.minLength > 0 && value.length < field.minLength) {
    isValid = false;
    errorMessage = `Minimum ${field.minLength} characters required`;
  }
  
  // Show error if invalid
  if (!isValid) {
    showFieldError(field, errorMessage);
  }
  
  return isValid;
}

function showFieldError(field, message) {
  field.classList.add('error');
  
  // Create error message element if it doesn't exist
  let errorEl = field.parentElement.querySelector('.form-error');
  if (!errorEl) {
    errorEl = document.createElement('span');
    errorEl.className = 'form-error';
    field.parentElement.appendChild(errorEl);
  }
  
  errorEl.textContent = message;
}

function clearFieldError(field) {
  field.classList.remove('error');
  const errorEl = field.parentElement.querySelector('.form-error');
  if (errorEl) {
    errorEl.remove();
  }
}

function showFormSuccess(form) {
  // Create success message
  const successEl = document.createElement('div');
  successEl.className = 'form-success animate-fade-in';
  successEl.innerHTML = `
    <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/>
      <polyline points="22 4 12 14.01 9 11.01"/>
    </svg>
    <h4>Thank You!</h4>
    <p>Your message has been sent successfully. We'll get back to you within 24 hours.</p>
  `;
  
  // Style the success message
  successEl.style.cssText = `
    text-align: center;
    padding: var(--space-10);
    color: var(--color-soft-gold);
  `;
  
  // Hide form and show success
  form.style.display = 'none';
  form.parentElement.appendChild(successEl);
}

/* ============================================
   11. BEFORE/AFTER SLIDER
   ============================================ */

function initComparisonSliders() {
  const sliders = document.querySelectorAll('.comparison-slider');
  
  sliders.forEach(slider => {
    const handle = slider.querySelector('.comparison-handle');
    const afterImage = slider.querySelector('.comparison-after');
    
    if (!handle || !afterImage) return;
    
    let isDragging = false;
    
    function updateSlider(x) {
      const rect = slider.getBoundingClientRect();
      let percentage = ((x - rect.left) / rect.width) * 100;
      
      // Clamp between 0 and 100
      percentage = Math.max(0, Math.min(100, percentage));
      
      handle.style.left = `${percentage}%`;
      afterImage.style.width = `${percentage}%`;
    }
    
    // Mouse events
    handle.addEventListener('mousedown', function(e) {
      isDragging = true;
      e.preventDefault();
    });
    
    document.addEventListener('mousemove', function(e) {
      if (isDragging) {
        updateSlider(e.clientX);
      }
    });
    
    document.addEventListener('mouseup', function() {
      isDragging = false;
    });
    
    // Touch events
    handle.addEventListener('touchstart', function(e) {
      isDragging = true;
    });
    
    document.addEventListener('touchmove', function(e) {
      if (isDragging) {
        updateSlider(e.touches[0].clientX);
      }
    });
    
    document.addEventListener('touchend', function() {
      isDragging = false;
    });
    
    // Click anywhere on slider to move handle
    slider.addEventListener('click', function(e) {
      if (e.target !== handle) {
        updateSlider(e.clientX);
      }
    });
    
    // Keyboard accessibility
    handle.setAttribute('tabindex', '0');
    handle.setAttribute('role', 'slider');
    handle.setAttribute('aria-valuemin', '0');
    handle.setAttribute('aria-valuemax', '100');
    handle.setAttribute('aria-valuenow', '50');
    
    handle.addEventListener('keydown', function(e) {
      const rect = slider.getBoundingClientRect();
      const currentPercentage = parseFloat(handle.style.left) || 50;
      let newPercentage = currentPercentage;
      
      if (e.key === 'ArrowLeft') {
        newPercentage = Math.max(0, currentPercentage - 5);
      } else if (e.key === 'ArrowRight') {
        newPercentage = Math.min(100, currentPercentage + 5);
      }
      
      if (newPercentage !== currentPercentage) {
        e.preventDefault();
        handle.style.left = `${newPercentage}%`;
        afterImage.style.width = `${newPercentage}%`;
        handle.setAttribute('aria-valuenow', newPercentage);
      }
    });
  });
}

/* ============================================
   12. COUNTER ANIMATION
   ============================================ */

function initCounterAnimations() {
  const counters = document.querySelectorAll('[data-counter]');
  
  if (counters.length === 0) return;
  
  const observerOptions = {
    root: null,
    rootMargin: '0px',
    threshold: 0.5
  };
  
  const counterObserver = new IntersectionObserver((entries, observer) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        animateCounter(entry.target);
        observer.unobserve(entry.target);
      }
    });
  }, observerOptions);
  
  counters.forEach(counter => {
    counterObserver.observe(counter);
  });
}

function animateCounter(element) {
  const target = parseInt(element.getAttribute('data-counter'), 10);
  const duration = parseInt(element.getAttribute('data-duration'), 10) || 2000;
  const suffix = element.getAttribute('data-suffix') || '';
  const prefix = element.getAttribute('data-prefix') || '';
  
  const startTime = performance.now();
  const startValue = 0;
  
  function updateCounter(currentTime) {
    const elapsed = currentTime - startTime;
    const progress = Math.min(elapsed / duration, 1);
    
    // Easing function (ease-out-cubic)
    const easedProgress = 1 - Math.pow(1 - progress, 3);
    
    const currentValue = Math.floor(startValue + (target - startValue) * easedProgress);
    element.textContent = prefix + currentValue.toLocaleString() + suffix;
    
    if (progress < 1) {
      requestAnimationFrame(updateCounter);
    }
  }
  
  requestAnimationFrame(updateCounter);
}

/* ============================================
   13. UTILITY FUNCTIONS
   ============================================ */

/**
 * Debounce function to limit the rate of function calls
 */
function debounce(func, wait = 100) {
  let timeout;
  return function executedFunction(...args) {
    const later = () => {
      clearTimeout(timeout);
      func(...args);
    };
    clearTimeout(timeout);
    timeout = setTimeout(later, wait);
  };
}

/**
 * Throttle function to ensure function is called at most once in specified period
 */
function throttle(func, limit = 100) {
  let inThrottle;
  return function executedFunction(...args) {
    if (!inThrottle) {
      func(...args);
      inThrottle = true;
      setTimeout(() => inThrottle = false, limit);
    }
  };
}

/**
 * Check if element is in viewport
 */
function isInViewport(element, offset = 0) {
  const rect = element.getBoundingClientRect();
  return (
    rect.top >= -offset &&
    rect.left >= 0 &&
    rect.bottom <= (window.innerHeight || document.documentElement.clientHeight) + offset &&
    rect.right <= (window.innerWidth || document.documentElement.clientWidth)
  );
}

/**
 * Get scroll percentage
 */
function getScrollPercentage() {
  const scrollTop = window.scrollY;
  const docHeight = document.documentElement.scrollHeight - window.innerHeight;
  return (scrollTop / docHeight) * 100;
}

/**
 * Lock body scroll
 */
function lockBodyScroll() {
  const scrollY = window.scrollY;
  document.body.style.position = 'fixed';
  document.body.style.top = `-${scrollY}px`;
  document.body.style.width = '100%';
}

/**
 * Unlock body scroll
 */
function unlockBodyScroll() {
  const scrollY = document.body.style.top;
  document.body.style.position = '';
  document.body.style.top = '';
  document.body.style.width = '';
  window.scrollTo(0, parseInt(scrollY || '0', 10) * -1);
}

/**
 * Copy text to clipboard
 */
async function copyToClipboard(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch (err) {
    console.error('Failed to copy:', err);
    return false;
  }
}

/**
 * Format currency
 */
function formatCurrency(amount, currency = 'GBP') {
  return new Intl.NumberFormat('en-GB', {
    style: 'currency',
    currency: currency
  }).format(amount);
}

/* ============================================
   14. PAGE-SPECIFIC INITIALIZATIONS
   ============================================ */

/**
 * Initialize pricing toggle (monthly/yearly)
 */
function initPricingToggle() {
  const toggle = document.querySelector('.pricing-toggle');
  if (!toggle) return;
  
  const monthlyPrices = document.querySelectorAll('[data-monthly]');
  const yearlyPrices = document.querySelectorAll('[data-yearly]');
  
  toggle.addEventListener('change', function() {
    const isYearly = this.checked;
    
    monthlyPrices.forEach(el => {
      el.style.display = isYearly ? 'none' : 'block';
    });
    
    yearlyPrices.forEach(el => {
      el.style.display = isYearly ? 'block' : 'none';
    });
  });
}

/**
 * Initialize portfolio filter
 */
function initPortfolioFilter() {
  const filterBtns = document.querySelectorAll('[data-filter]');
  const portfolioItems = document.querySelectorAll('[data-category]');
  
  if (filterBtns.length === 0) return;
  
  filterBtns.forEach(btn => {
    btn.addEventListener('click', function() {
      const filter = this.getAttribute('data-filter');
      
      // Update active button
      filterBtns.forEach(b => b.classList.remove('active'));
      this.classList.add('active');
      
      // Filter items
      portfolioItems.forEach(item => {
        const category = item.getAttribute('data-category');
        
        if (filter === 'all' || category === filter) {
          item.style.display = '';
          item.classList.add('animate-fade-in');
        } else {
          item.style.display = 'none';
          item.classList.remove('animate-fade-in');
        }
      });
    });
  });
}

/**
 * Initialize testimonial slider
 */
function initTestimonialSlider() {
  const slider = document.querySelector('.testimonial-slider');
  if (!slider) return;
  
  const slides = slider.querySelectorAll('.testimonial-slide');
  const prevBtn = slider.querySelector('.slider-prev');
  const nextBtn = slider.querySelector('.slider-next');
  const dots = slider.querySelectorAll('.slider-dot');
  
  let currentSlide = 0;
  let autoplayInterval;
  
  function showSlide(index) {
    // Handle wrap around
    if (index >= slides.length) index = 0;
    if (index < 0) index = slides.length - 1;
    
    slides.forEach((slide, i) => {
      slide.classList.toggle('active', i === index);
    });
    
    dots.forEach((dot, i) => {
      dot.classList.toggle('active', i === index);
    });
    
    currentSlide = index;
  }
  
  function nextSlide() {
    showSlide(currentSlide + 1);
  }
  
  function prevSlide() {
    showSlide(currentSlide - 1);
  }
  
  function startAutoplay() {
    autoplayInterval = setInterval(nextSlide, 5000);
  }
  
  function stopAutoplay() {
    clearInterval(autoplayInterval);
  }
  
  // Event listeners
  if (nextBtn) nextBtn.addEventListener('click', nextSlide);
  if (prevBtn) prevBtn.addEventListener('click', prevSlide);
  
  dots.forEach((dot, i) => {
    dot.addEventListener('click', () => showSlide(i));
  });
  
  // Pause autoplay on hover
  slider.addEventListener('mouseenter', stopAutoplay);
  slider.addEventListener('mouseleave', startAutoplay);
  
  // Touch/swipe support
  let touchStartX = 0;
  let touchEndX = 0;
  
  slider.addEventListener('touchstart', e => {
    touchStartX = e.changedTouches[0].screenX;
    stopAutoplay();
  }, { passive: true });
  
  slider.addEventListener('touchend', e => {
    touchEndX = e.changedTouches[0].screenX;
    const diff = touchStartX - touchEndX;
    
    if (Math.abs(diff) > 50) {
      if (diff > 0) {
        nextSlide();
      } else {
        prevSlide();
      }
    }
    
    startAutoplay();
  }, { passive: true });
  
  // Initialize
  showSlide(0);
  startAutoplay();
}

/**
 * Initialize modal functionality
 */
function initModals() {
  const modalTriggers = document.querySelectorAll('[data-modal]');
  const modalCloses = document.querySelectorAll('.modal-close, .modal-overlay');
  
  modalTriggers.forEach(trigger => {
    trigger.addEventListener('click', function(e) {
      e.preventDefault();
      const modalId = this.getAttribute('data-modal');
      const modal = document.getElementById(modalId);
      
      if (modal) {
        modal.classList.add('active');
        lockBodyScroll();
      }
    });
  });
  
  modalCloses.forEach(close => {
    close.addEventListener('click', function(e) {
      if (e.target === this) {
        const modal = this.closest('.modal-overlay');
        if (modal) {
          modal.classList.remove('active');
          unlockBodyScroll();
        }
      }
    });
  });
  
  // Close on escape
  document.addEventListener('keydown', function(e) {
    if (e.key === 'Escape') {
      const activeModal = document.querySelector('.modal-overlay.active');
      if (activeModal) {
        activeModal.classList.remove('active');
        unlockBodyScroll();
      }
    }
  });
}

/**
 * Initialize lazy loading for images
 */
function initLazyLoading() {
  const lazyImages = document.querySelectorAll('img[data-src]');
  
  if ('IntersectionObserver' in window) {
    const imageObserver = new IntersectionObserver((entries, observer) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          const img = entry.target;
          img.src = img.getAttribute('data-src');
          img.removeAttribute('data-src');
          img.classList.add('loaded');
          observer.unobserve(img);
        }
      });
    }, {
      rootMargin: '50px 0px'
    });
    
    lazyImages.forEach(img => {
      imageObserver.observe(img);
    });
  } else {
    // Fallback for older browsers
    lazyImages.forEach(img => {
      img.src = img.getAttribute('data-src');
      img.removeAttribute('data-src');
    });
  }
}

/* ============================================
   EXPORT FUNCTIONS FOR EXTERNAL USE
   ============================================ */

// Make functions available globally if needed
window.BuiltRightStudio = {
  initMobileNav,
  initStickyHeader,
  initAnnouncementBar,
  initScrollReveal,
  initAccordions,
  initTabs,
  initFloatingCTA,
  initSmoothScroll,
  initForms,
  initComparisonSliders,
  initCounterAnimations,
  initPricingToggle,
  initPortfolioFilter,
  initTestimonialSlider,
  initModals,
  initLazyLoading,
  debounce,
  throttle,
  isInViewport,
  getScrollPercentage,
  lockBodyScroll,
  unlockBodyScroll,
  copyToClipboard,
  formatCurrency
};

/* ============================================
   END OF MAIN JAVASCRIPT
   ============================================ */
