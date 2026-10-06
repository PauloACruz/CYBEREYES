package proto

import (
	"bytes"
	"testing"
)

func TestTileAndFrameEndLayout(t *testing.T) {
	tile := TileFrame(7, 64, 128, 256, 64, []byte{0xff, 0xd8})
	want := []byte{Tile, 0, 0, 0, 7, 0, 64, 0, 128, 1, 0, 0, 64, 0xff, 0xd8}
	if !bytes.Equal(tile, want) {
		t.Fatalf("TILE %v, esperado %v", tile, want)
	}
	end := FrameEndFrame(7, 3, 1920, 1080)
	if !bytes.Equal(end, []byte{FrameEnd, 0, 0, 0, 7, 0, 3, 7, 128, 4, 56}) {
		t.Fatalf("FRAME_END %v", end)
	}
}

func TestAckAndChunk(t *testing.T) {
	f, ms, err := ParseAck([]byte{Ack, 0, 0, 1, 0, 0, 0, 0, 42})
	if err != nil || f != 256 || ms != 42 {
		t.Fatalf("ACK %d %d %v", f, ms, err)
	}
	if _, _, err := ParseAck([]byte{Ack, 1}); err == nil {
		t.Fatal("ACK curto deve falhar")
	}
	c := ChunkFrame(5, 1<<33, []byte("abc"))
	id, off, data, err := ParseChunk(c)
	if err != nil || id != 5 || off != 1<<33 || string(data) != "abc" {
		t.Fatalf("CHUNK %d %d %q %v", id, off, data, err)
	}
}

func TestJSONRoundTrip(t *testing.T) {
	f, err := JSON(Key, KeyBody{Code: "KeyA", Down: true})
	if err != nil || f[0] != Key {
		t.Fatal(err)
	}
	var k KeyBody
	if err := Decode(f, &k); err != nil || k.Code != "KeyA" || !k.Down {
		t.Fatalf("%+v %v", k, err)
	}
	if err := Decode([]byte{Key}, &k); err == nil {
		t.Fatal("quadro sem corpo deve falhar")
	}
}
