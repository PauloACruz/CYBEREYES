package inventory

import (
	"math"
	"time"
)

// serverConfig e a resposta de GET /api/v3/{agent_id}/config/ (segundos; float para aceitar qualquer numero).
type serverConfig struct {
	CheckinHello     float64 `json:"checkin_hello"`
	CheckinAgentInfo float64 `json:"checkin_agentinfo"`
	CheckinWinSvc    float64 `json:"checkin_winsvc"`
	CheckinPubIP     float64 `json:"checkin_pubip"`
	CheckinDisks     float64 `json:"checkin_disks"`
	CheckinSW        float64 `json:"checkin_sw"`
	CheckinWMI       float64 `json:"checkin_wmi"`
}

// intervals sao os intervalos efetivos dos check-ins.
type intervals struct {
	Hello, AgentInfo, WinSvc, PublicIP, Disks, Software, WMI time.Duration
}

// limite de cada intervalo: padrao (meio da faixa do servidor), minimo e maximo aceitos.
type limit struct{ def, min, max time.Duration }

var (
	limHello     = limit{45 * time.Second, 15 * time.Second, 10 * time.Minute}
	limAgentInfo = limit{300 * time.Second, time.Minute, 2 * time.Hour}
	limWinSvc    = limit{2700 * time.Second, 5 * time.Minute, 24 * time.Hour}
	limPublicIP  = limit{400 * time.Second, time.Minute, 24 * time.Hour}
	limDisks     = limit{1500 * time.Second, time.Minute, 24 * time.Hour}
	limSoftware  = limit{3150 * time.Second, 15 * time.Minute, 24 * time.Hour}
	limWMI       = limit{3500 * time.Second, 15 * time.Minute, 24 * time.Hour}
)

func defaultIntervals() intervals {
	return intervals{
		Hello: limHello.def, AgentInfo: limAgentInfo.def, WinSvc: limWinSvc.def, PublicIP: limPublicIP.def,
		Disks: limDisks.def, Software: limSoftware.def, WMI: limWMI.def,
	}
}

// clamp converte segundos em duracao dentro dos limites; ausente, zero ou invalido vale o padrao.
func (l limit) clamp(sec float64) time.Duration {
	if math.IsNaN(sec) || math.IsInf(sec, 0) || sec <= 0 {
		return l.def
	}
	if sec > l.max.Seconds() {
		return l.max
	}
	d := time.Duration(sec * float64(time.Second))
	if d < l.min {
		return l.min
	}
	return d
}

func (c serverConfig) intervals() intervals {
	return intervals{
		Hello:     limHello.clamp(c.CheckinHello),
		AgentInfo: limAgentInfo.clamp(c.CheckinAgentInfo),
		WinSvc:    limWinSvc.clamp(c.CheckinWinSvc),
		PublicIP:  limPublicIP.clamp(c.CheckinPubIP),
		Disks:     limDisks.clamp(c.CheckinDisks),
		Software:  limSoftware.clamp(c.CheckinSW),
		WMI:       limWMI.clamp(c.CheckinWMI),
	}
}
