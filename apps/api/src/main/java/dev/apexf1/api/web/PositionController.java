package dev.apexf1.api.web;

import dev.apexf1.api.dto.replay.PositionFrame;
import dev.apexf1.api.dto.replay.ReplayCar;
import dev.apexf1.api.persistence.entity.PositionSampleEntity;
import dev.apexf1.api.persistence.repository.PositionSampleRepository;
import java.util.List;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/sessions")
public class PositionController {

    private static final long FRAME_INTERVAL_MS = 100;

    private final PositionSampleRepository positionSampleRepository;

    public PositionController(PositionSampleRepository positionSampleRepository) {
        this.positionSampleRepository = positionSampleRepository;
    }

    @GetMapping("/{sessionKey}/replay")
    public PositionFrame getReplay(
            @PathVariable int sessionKey,
            @RequestParam long from,
            @RequestParam long to) {

        List<PositionSampleEntity> samples =
                positionSampleRepository
                        .findBySessionKeyAndSampleTimeMsBetweenOrderBySampleTimeMs(
                                sessionKey,
                                from,
                                to);

        if (samples.isEmpty()) {
            return PositionFrame.replay(sessionKey, from, List.of());
        }

        long timestamp = (from / FRAME_INTERVAL_MS) * FRAME_INTERVAL_MS;

        List<ReplayCar> cars = samples.stream()
                .collect(java.util.stream.Collectors.toMap(
                        PositionSampleEntity::getDriverNumber,
                        sample -> new ReplayCar(
                                sample.getDriverNumber(),
                                sample.getX(),
                                sample.getY(),
                                sample.getZ(),
                                sample.getSampleTimeMs()),
                        (first, second) ->
                                Math.abs(first.sampleT() - timestamp)
                                        <= Math.abs(second.sampleT() - timestamp)
                                        ? first : second))
                .values()
                .stream()
                .toList();

        return PositionFrame.replay(sessionKey, timestamp, cars);
    }

    @GetMapping("/{sessionKey}/replay/timeline")
    public List<PositionFrame> getReplayTimeline(
            @PathVariable int sessionKey,
            @RequestParam long from,
            @RequestParam long to) {

        if (from >= to) {
            throw new IllegalArgumentException("from must be before to");
        }

        List<PositionSampleEntity> samples =
                positionSampleRepository
                        .findBySessionKeyAndSampleTimeMsBetweenOrderBySampleTimeMs(
                                sessionKey,
                                from,
                                to);

        List<PositionFrame> frames = new java.util.ArrayList<>();

        for (long timestamp = (from / FRAME_INTERVAL_MS) * FRAME_INTERVAL_MS;
             timestamp <= to;
             timestamp += FRAME_INTERVAL_MS) {

            final long frameTime = timestamp;

            List<ReplayCar> cars = samples.stream()
                    .collect(java.util.stream.Collectors.toMap(
                            PositionSampleEntity::getDriverNumber,
                            sample -> new ReplayCar(
                                    sample.getDriverNumber(),
                                    sample.getX(),
                                    sample.getY(),
                                    sample.getZ(),
                                    sample.getSampleTimeMs()),
                            (first, second) ->
                                    Math.abs(first.sampleT() - frameTime)
                                            <= Math.abs(second.sampleT() - frameTime)
                                            ? first : second))
                    .values()
                    .stream()
                    .toList();

            frames.add(PositionFrame.replay(
                    sessionKey,
                    frameTime,
                    cars));
        }

        return frames;
    }

    @GetMapping("/{sessionKey}/drivers/{driverNumber}/positions")
    public PositionFrame getPositions(
            @PathVariable int sessionKey,
            @PathVariable int driverNumber,
            @RequestParam long from,
            @RequestParam long to) {

        List<PositionSampleEntity> samples =
                positionSampleRepository
                        .findBySessionKeyAndDriverNumberAndSampleTimeMsBetweenOrderBySampleTimeMs(
                                sessionKey,
                                driverNumber,
                                from,
                                to);

        if (samples.isEmpty()) {
            return PositionFrame.replay(sessionKey, from, List.of());
        }

        long timestamp = (from / FRAME_INTERVAL_MS) * FRAME_INTERVAL_MS;

        List<ReplayCar> cars = samples.stream()
                .collect(java.util.stream.Collectors.toMap(
                        PositionSampleEntity::getDriverNumber,
                        sample -> new ReplayCar(
                                sample.getDriverNumber(),
                                sample.getX(),
                                sample.getY(),
                                sample.getZ(),
                                sample.getSampleTimeMs()),
                        (first, second) ->
                                Math.abs(first.sampleT() - timestamp)
                                        <= Math.abs(second.sampleT() - timestamp)
                                        ? first : second))
                .values()
                .stream()
                .toList();

        return PositionFrame.replay(sessionKey, timestamp, cars);
    }
}
