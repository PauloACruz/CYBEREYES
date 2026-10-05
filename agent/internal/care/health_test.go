package care

import (
	"context"
	"encoding/json"
	"regexp"
	"runtime"
	"testing"
	"time"
)

func TestHealthScoreAndShape(t *testing.T) {
	probes := []probe{
		{key: "a", label: "A", category: catPerformance, timeout: time.Second, first: true, fn: func(context.Context) []HealthItem {
			return []HealthItem{{Key: "a", Label: "A", Category: catPerformance, Status: hOK, Weight: 10}}
		}},
		{key: "b", label: "B", category: catStorage, timeout: time.Second, fn: func(context.Context) []HealthItem {
			return []HealthItem{
				{Key: "b1", Label: "B1", Category: catStorage, Status: hWarning, Weight: 15},
				{Key: "b2", Label: "B2", Category: catStorage, Status: hCritical, Weight: 5},
			}
		}},
		// Nao se aplica: nenhum item.
		{key: "c", label: "C", category: catSecurity, timeout: time.Second, fn: func(context.Context) []HealthItem { return nil }},
		// Sonda que estoura o prazo vira unknown, fora da conta.
		{key: "slow", label: "Lenta", category: catSecurity, timeout: 100 * time.Millisecond, fn: func(context.Context) []HealthItem {
			time.Sleep(2 * time.Second)
			return []HealthItem{{Key: "slow", Status: hOK, Weight: 50}}
		}},
		{key: "p", label: "Panico", category: catSecurity, timeout: time.Second, fn: func(context.Context) []HealthItem { panic("x") }},
	}
	start := time.Now()
	rep := collect(t.Context(), "linux", probes, func() time.Time { return time.Date(2026, 10, 1, 10, 0, 0, 0, time.UTC) })
	if time.Since(start) > time.Second {
		t.Fatalf("a coleta esperou a sonda lenta: %s", time.Since(start))
	}
	// pontos: 10 + 7 + 0 = 17 de 30 -> 56,7 -> 57
	if rep.Score != 57 || rep.Grade != "atencao" {
		t.Fatalf("score %d grade %s", rep.Score, rep.Grade)
	}
	if len(rep.Items) != 5 || rep.Items[3].Key != "slow" || rep.Items[3].Status != hUnknown || rep.Items[3].Weight != 0 {
		t.Fatalf("itens: %+v", rep.Items)
	}
	if rep.Items[4].Status != hUnknown || rep.Items[4].Points != 0 {
		t.Fatalf("panico: %+v", rep.Items[4])
	}
	b, _ := json.Marshal(rep)
	want := `{"score":57,"grade":"atencao","collectedAt":"2026-10-01T10:00:00Z","platform":"linux","items":[`
	if string(b[:len(want)]) != want {
		t.Fatalf("JSON: %s", b)
	}
}

func TestGradeAndScore(t *testing.T) {
	for s, g := range map[int]string{100: "otimo", 90: "otimo", 89: "bom", 75: "bom", 74: "atencao", 50: "atencao", 49: "critico", 0: "critico"} {
		if gradeFor(s) != g {
			t.Errorf("gradeFor(%d) = %s", s, gradeFor(s))
		}
	}
	if s, g := score(nil); s != 0 || g != "critico" {
		t.Errorf("score vazio: %d %s", s, g)
	}
	if it := diskItem("/", 100<<30, 10<<30, true); it.Status != hWarning || it.Weight != 15 {
		t.Errorf("disco 10%%: %+v", it)
	}
	if it := diskItem("/data", 1000<<30, 60<<30, false); it.Status != hOK {
		t.Errorf("disco grande com 60 GB livres: %+v", it)
	}
	if it := memoryItem(16<<30, 512<<20); it.Status != hCritical {
		t.Errorf("memoria 97%%: %+v", it)
	}
	if it := updatesItem(3, 1, ""); it.Status != hCritical {
		t.Errorf("atualizacoes de seguranca: %+v", it)
	}
}

// Health Check real da maquina de teste: formato do contrato e prazo.
func TestCollectHealthLocal(t *testing.T) {
	start := time.Now()
	rep := CollectHealth(t.Context())
	elapsed := time.Since(start)
	if elapsed > healthDeadline+5*time.Second {
		t.Fatalf("coleta demorou %s", elapsed)
	}
	b, err := json.Marshal(rep)
	if err != nil {
		t.Fatal(err)
	}
	t.Logf("coleta em %s: %s", elapsed, b)
	if !regexp.MustCompile(`^\{"score":\d{1,3},"grade":"(otimo|bom|atencao|critico)","collectedAt":"[^"]+","platform":"` + runtime.GOOS + `","items":\[`).Match(b) {
		t.Fatalf("formato: %s", b)
	}
	if _, err := time.Parse(time.RFC3339, rep.CollectedAt); err != nil {
		t.Fatal(err)
	}
	if rep.Score < 0 || rep.Score > 100 || len(rep.Items) < 3 {
		t.Fatalf("relatorio: %+v", rep)
	}
	seen := map[string]bool{}
	for _, it := range rep.Items {
		if seen[it.Key] || it.Key == "" || it.Label == "" || it.Category == "" {
			t.Errorf("item invalido ou repetido: %+v", it)
		}
		seen[it.Key] = true
		switch it.Status {
		case hOK:
			if it.Points != it.Weight {
				t.Errorf("pontos de item ok: %+v", it)
			}
		case hWarning, hCritical:
			if it.Points > it.Weight {
				t.Errorf("pontos: %+v", it)
			}
		case hUnknown:
			if it.Weight != 0 || it.Points != 0 {
				t.Errorf("unknown conta na nota: %+v", it)
			}
		default:
			t.Errorf("status invalido: %+v", it)
		}
	}
	for _, k := range []string{"cpu", "memory", "uptime"} {
		if !seen[k] {
			t.Errorf("faltou o item %s", k)
		}
	}
}
