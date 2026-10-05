package winevt

import "testing"

func TestDataFromXML(t *testing.T) {
	doc := `<Event xmlns="http://schemas.microsoft.com/win/2004/08/events/event"><System><Provider Name="X"/><EventID>7</EventID></System>` +
		`<EventData><Data Name="param1">valor um</Data><Data>solto</Data><Data Name="vazio"></Data></EventData></Event>`
	got := dataFromXML(doc)
	want := "param1: valor um\nsolto"
	if got != want {
		t.Fatalf("got %q want %q", got, want)
	}
	user := `<Event><UserData><LogFileCleared><SubjectUserName>admin</SubjectUserName></LogFileCleared></UserData></Event>`
	if got := dataFromXML(user); got != "SubjectUserName: admin" {
		t.Fatalf("userdata: got %q", got)
	}
	if got := dataFromXML("nao e xml"); got != "" {
		t.Fatalf("invalido: got %q", got)
	}
}
