export function toggleMobileMenu() {
    const menu = document.getElementById('mobileMenu');
    if (menu) {
        menu.classList.toggle('hidden');
    }
}

export function showSection(sectionId) {
    document.querySelectorAll('.section-content').forEach(sec => sec.classList.add('hidden'));
    const section = document.getElementById(sectionId);
    if (section) section.classList.remove('hidden');
    if (window.innerWidth < 768) {
        const menu = document.getElementById('mobileMenu');
        if (menu) menu.classList.add('hidden');
    }
}

window.nav = { toggleMobileMenu, showSection };
