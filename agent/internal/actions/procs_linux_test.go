//go:build linux

package actions

import "testing"

func TestParseStat(t *testing.T) {
	line := "1234 (my (odd) proc) S 1 1234 1234 0 -1 4194560 100 0 0 0 250 50 0 0 20 0 1 0 100 1000000 321 18446744073709551615"
	st, err := parseStat([]byte(line))
	if err != nil {
		t.Fatal(err)
	}
	if st.comm != "my (odd) proc" || st.ticks != 300 || st.rss != 321 {
		t.Fatalf("parseStat = %+v", st)
	}
	if _, err := parseStat([]byte("lixo")); err == nil {
		t.Fatal("deveria falhar")
	}
	if statusUID([]byte("Name:\tx\nUid:\t1000\t1001\t1000\t1000\n")) != "1001" {
		t.Fatal("statusUID")
	}
}
