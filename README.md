# Mody Claude Code

Moje mody do Claude Code (marketplace `mody-olka`), styl odpowiedzi `punkty` i globalny `CLAUDE.md`.

## Mody

| Mod | Co robi | Działa u każdego? |
|---|---|---|
| `cache-bar` | Linia nad promptem: odliczanie cache, zajęty kontekst, limity 5h/7d, przycisk handoff powyżej 50% kontekstu. | tak |
| `cache-tax` | W przerwach podtrzymuje ciepły cache i raz zatrzymuje zimne wysłanie, pokazując jego koszt. `/cache-tax` - dziennik. | tak |
| `progres-bar` | Pasek ładowania z listy zadań Claude'a: procent, etap X z Y, krok w toku, czas do końca. | tak |
| `agenci` | Pasek z agentami sesji: typ, zadanie, bieżąca czynność, czas. | tak |
| `co-dalej` | Pod zakończonym zadaniem trzy propozycje usprawnień, klawisze 1-3 je wysyłają. | tak |
| `wyjasnij` | `/wyjasnij` - po polsku, krok po kroku, co Claude właśnie zrobił. Na podstawie ruthannbravo/explain-it. | tak |
| `rachunek` | `/rachunek` - koszt rozmowy w podziale na tury, najdroższa tura, najcięższy odczyt. | tak |
| `glos` | Po długiej turze czyta streszczenie polskim głosem Windowsa. `/glos` włącza i wyłącza. | Windows z głosem Paulina |
| `pamiec-projektu` | Pasek z notatką pamięci Claude'a dla projektu, nad którym pracujesz. Sam znajduje pamięć Claude'a dla Twojego folderu, a projekty bierze z jego podfolderu `Projekty` (inne foldery ustawisz w opcjach moda). Folder o nic niemówiącej nazwie przypniesz do notatki linijką `folder: <nazwa>` w jej nagłówku. | tak, gdy Claude ma już notatki w pamięci |
| `spolszczacz` | `/spolszcz` - postęp tłumaczenia gry i przycisk „następna partia”. | wymaga mojej struktury spolszczeń |
| `later` | `/later` - notatnik promptów na później, osobny dla każdego projektu. Leży w `local-mods/later`. | tak |

## Instalacja

```bash
git clone https://github.com/psv90/claude-config.git
claude plugin marketplace add ./claude-config
claude plugin install cache-bar@mody-olka --scope user
```

- Każdy mod z `plugins/` instaluje się tak samo: `claude plugin install <mod>@mody-olka --scope user`.
- `later` ma osobny marketplace: `claude plugin marketplace add ./claude-config/local-mods/later`, potem `claude plugin install later@local-mods --scope user`.
- Po instalacji uruchom nową sesję.

## Ustawienia

- `ustawienia/CLAUDE.md` - kopia `~/.claude/CLAUDE.md`.
- `ustawienia/output-styles/punkty.md` - kopia `~/.claude/output-styles/punkty.md`. Wrzuć ją do tego samego folderu u siebie i wybierz styl `punkty`.
