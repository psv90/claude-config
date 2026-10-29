# later - notatnik promptów na później

Zapisujesz prompty, których nie chcesz (albo nie możesz, bo skończył się limit) wykonać teraz. Każdy projekt ma swoją listę (nazwa folderu), możesz też tworzyć własne grupy, np. na inny czat.

## Przyciski

**Pasek nad polem promptu** (zawsze widoczny):
- **Zapisz na później** - zabiera to, co wpisałeś w pole promptu, zapisuje w liście projektu i czyści pole.
- **Lista** - otwiera panel „Na później”.
- Gdy projekt ma zapisane prompty: pomarańczowy, pogrubiony licznik `▸ N prompty na później`, początek pierwszego promptu i **Wyślij następny**.
- **Wyślij wszystkie (N)** (od 2 promptów, w pasku i w panelu) - po potwierdzeniu w miejscu wysyła prompty po kolei: następny dopiero po odpowiedzi na poprzedni. Błąd tury (np. limit) albo przerwanie zatrzymuje kolejkę, niewysłane prompty zostają na liście. **Stop** przerywa ręcznie.

**Panel „Na później”:**
- Nagłówek: `later`, wybór grupy, liczba w kolejce i **+ grupa** (nazwa nowej grupy + Enter).
- Wiersze jak w logu: `▸` przy następnym prompcie, wiek, treść.
- Każdy prompt pamięta czat, w którym go zapisano. Prompt z innego czatu ma `↗` i tytuł tamtego czatu: kliknięcie w jego treść przenosi do tamtego czatu (aplikacja desktopowa, link `claude://claude.ai/epitaxy/<czat>`). Prompty zapisane przed wersją 0.8.0 nie mają czatu i strzałki.
- Pole `›` na dole - wpisz prompt i Enter, zapisuje w wybranej grupie.
- Po najechaniu na wiersz (w terminalu zawsze): **Wyślij** (wysyła i zdejmuje z listy), **Edytuj** (wstawia do pola promptu i zdejmuje z listy), **Usuń** (potwierdzenie „Usunąć #N? Usuń / Anuluj” w tym samym miejscu).

## Komendy (opcjonalnie)

`/later` otwiera panel. Dalej działają też: `/later <prompt>`, `/later @grupa <prompt>`, `/later list`, `/later all`, `/later run|use|rm <nr>`, `/later help`.

Dane: magazyn pluginu (`$.store`), wspólny dla wszystkich sesji.

Znane: Wyślij zdejmuje prompt z listy od razu; jeśli limit wciąż trwa, prompt zostaje tylko w historii czatu.
