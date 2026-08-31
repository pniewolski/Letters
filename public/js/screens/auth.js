/**
 * @file screens/auth.js
 * @description Logowanie, rejestracja, gra jako gość i awans gościa na pełne
 * konto. Wszystko dzieje się w oknie modalnym, żeby nie wyrzucać gracza
 * z ekranu, na którym akurat jest.
 */

import { el, modal, toast } from '../ui.js';
import { store, setState, setToken } from '../store.js';
import { api } from '../api.js';
import { authenticate, connect, disconnect } from '../net.js';
import { refresh } from '../router.js';

/**
 * Zapisuje zalogowane konto i podłącza WebSocket.
 * @param {object} result - Odpowiedź `/api/auth/*`
 * @param {boolean} guest - Czy to sesja gościa (token trafia do sessionStorage)
 */
function applySession(result, guest) {
    setToken(result.token, guest);
    setState({ user: result.user });
    connect();
    authenticate();
}

/**
 * Loguje jako gość — bez hasła, na czas jednej sesji przeglądarki.
 * @param {string} [name] - Nazwa widoczna dla innych
 * @returns {Promise<object>} Konto gościa
 */
export async function playAsGuest(name) {
    const result = await api.post('/auth/guest', { name });
    applySession(result, true);
    toast(`Grasz jako ${result.user.displayName}. Dorobek zniknie, gdy zamkniesz kartę.`, 'info', 6000);
    return result.user;
}

/** Wylogowuje i czyści stan. */
export async function logout() {
    try { await api.post('/auth/logout'); } catch { /* sesja i tak przepada */ }
    setToken(null);
    setState({ user: null, table: null, game: null, results: null, tables: [] });
    disconnect();
    connect();
    refresh();
    toast('Wylogowano.', 'info');
}

/**
 * Otwiera okno logowania lub rejestracji.
 * @param {'login'|'register'|'guest'} [mode='login'] - Zakładka startowa
 */
export function openAuthModal(mode = 'login') {
    let dialog = null;
    let current = mode;

    const body = el('div', { class: 'auth-modal' });

    const render = () => {
        const tabs = el('div', { class: 'tabs' },
            tab('login', 'Logowanie'),
            tab('register', 'Rejestracja'),
            tab('guest', 'Gość'),
        );
        body.replaceChildren(tabs, formFor(current));
    };

    const tab = (key, label) => el('button', {
        class: `tab ${current === key ? 'active' : ''}`,
        type: 'button',
        onclick: () => { current = key; render(); },
    }, label);

    /**
     * Buduje formularz dla wybranej zakładki.
     * @param {string} kind
     * @returns {HTMLElement}
     */
    function formFor(kind) {
        const error = el('p', { class: 'form-error' });

        /**
         * Opakowuje wysyłkę formularza: blokuje przycisk i pokazuje błąd.
         * @param {HTMLElement} button
         * @param {Function} fn
         */
        const submit = async (button, fn) => {
            error.textContent = '';
            button.disabled = true;
            try {
                await fn();
                dialog.close();
                refresh();
            } catch (err) {
                error.textContent = err.message;
            } finally {
                button.disabled = false;
            }
        };

        if (kind === 'guest') {
            const name = el('input', { type: 'text', placeholder: 'Jak mamy cię nazywać?', maxlength: '24' });
            const button = el('button', { class: 'btn btn-primary full' }, 'Graj jako gość');
            button.onclick = () => submit(button, () => playAsGuest(name.value.trim()));

            return el('form', { class: 'form', onsubmit: e => e.preventDefault() },
                el('p', { class: 'muted small' },
                    'Gość gra bez zakładania konta. Statystyki i stoły żyją tak długo, '
                    + 'jak sesja w tej karcie przeglądarki — po jej zamknięciu przepadają. '
                    + 'W każdej chwili możesz zamienić konto gościa w pełne i zachować dorobek.'),
                name, error, button,
            );
        }

        if (kind === 'register') {
            const username = el('input', { type: 'text', placeholder: 'Nazwa konta (login)', maxlength: '20', autocomplete: 'username' });
            const display = el('input', { type: 'text', placeholder: 'Nazwa widoczna dla innych', maxlength: '24' });
            const password = el('input', { type: 'password', placeholder: 'Hasło (min. 6 znaków)', autocomplete: 'new-password' });
            const button = el('button', { class: 'btn btn-primary full' }, 'Załóż konto');

            button.onclick = () => submit(button, async () => {
                // Gość, który zakłada konto, zabiera ze sobą dotychczasowy dorobek.
                const result = store.user?.isGuest
                    ? await api.post('/auth/upgrade', {
                        username: username.value.trim(),
                        password: password.value,
                        displayName: display.value.trim(),
                    })
                    : await api.post('/auth/register', {
                        username: username.value.trim(),
                        password: password.value,
                        displayName: display.value.trim(),
                    });

                applySession(result, false);
                toast(`Cześć, ${result.user.displayName}!`, 'ok');
            });

            return el('form', { class: 'form', onsubmit: e => e.preventDefault() },
                store.user?.isGuest
                    ? el('p', { class: 'notice' },
                        'Grasz teraz jako gość. Po założeniu konta zachowasz rozegrane partie i statystyki.')
                    : null,
                username, display, password, error, button,
                el('p', { class: 'muted tiny' },
                    'Login: 3–20 znaków, małe litery, cyfry, kropka, myślnik lub podkreślenie.'),
            );
        }

        const username = el('input', { type: 'text', placeholder: 'Nazwa konta', maxlength: '20', autocomplete: 'username' });
        const password = el('input', { type: 'password', placeholder: 'Hasło', autocomplete: 'current-password' });
        const button = el('button', { class: 'btn btn-primary full' }, 'Zaloguj');

        button.onclick = () => submit(button, async () => {
            const result = await api.post('/auth/login', {
                username: username.value.trim(),
                password: password.value,
            });
            applySession(result, false);
            toast(`Witaj z powrotem, ${result.user.displayName}!`, 'ok');
        });

        const onEnter = e => { if (e.key === 'Enter') button.click(); };
        username.addEventListener('keydown', onEnter);
        password.addEventListener('keydown', onEnter);

        return el('form', { class: 'form', onsubmit: e => e.preventDefault() },
            username, password, error, button);
    }

    render();
    dialog = modal({ title: 'Konto', body });
}

/**
 * Ekran pod adresem `#/konto` — na wypadek wejścia z linku.
 * @param {HTMLElement} host
 * @returns {Function}
 */
export default function authScreen(host) {
    host.replaceChildren();
    openAuthModal(store.user ? 'register' : 'login');
    return () => {};
}
