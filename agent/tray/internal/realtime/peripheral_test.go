package realtime

import (
	"reflect"
	"testing"
)

func TestPeripheralTestDispatch(t *testing.T) {
	rec := &recorder{}
	c := &Client{Handler: rec}
	for _, raw := range []string{
		`{"type":1,"target":"peripheralTestStart","arguments":[{"testId":7,"section":"keyboard","technician":"Ana Souza"}]}`,
		`{"type":1,"target":"peripheralTestStart","arguments":[{"testId":0,"section":"keyboard"}]}`,
		`{"type":1,"target":"peripheralTestStart","arguments":[]}`,
		`{"type":1,"target":"peripheralTestStop","arguments":[{"testId":7}]}`,
		`{"type":1,"target":"peripheralTestStop","arguments":["x"]}`,
	} {
		msg, err := ParseMessage([]byte(raw))
		if err != nil {
			t.Fatal(err)
		}
		c.dispatch(msg)
	}
	if want := []string{"start 7 keyboard Ana Souza", "stop 7"}; !reflect.DeepEqual(rec.peripheral, want) {
		t.Fatalf("eventos: %v, esperava %v", rec.peripheral, want)
	}
}
